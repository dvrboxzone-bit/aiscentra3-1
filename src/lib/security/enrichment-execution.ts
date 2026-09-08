import { NextResponse } from 'next/server'

// Same control row used by Durable SIS start/claim. No independent flag or cache.
export const ENRICHMENT_CONTROL_KEY = 'durable_sis_v1_control_20260825'
export const LEGACY_ADMISSION_PREFIX = 'legacy-enrichment-admission:'

export interface EnrichmentExecutionAdmission {
  holder: string
  lockName: string
}

type AdmissionResult =
  | { admission: EnrichmentExecutionAdmission; response: null }
  | { admission: null; response: NextResponse }

export async function readEnrichmentExecutionState(): Promise<unknown> {
  const { createAdminClient } = await import('@/lib/supabase/server')
  // Generated database types predate this server-only control table.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any
  const { data, error } = await db
    .from('sis_execution_controls')
    .select('execution_enabled')
    .eq('control_key', ENRICHMENT_CONTROL_KEY)
    .single()
  if (error) throw new Error('Execution state unavailable')
  return data?.execution_enabled
}

/** Call AFTER authentication, BEFORE any enrichment work or mutation. */
export async function guardEnrichmentExecution(
  readState: () => Promise<unknown> = readEnrichmentExecutionState,
): Promise<NextResponse | null> {
  try {
    const enabled = await readState()
    if (enabled === true) return null
    if (enabled === false) {
      return NextResponse.json({ skipped: true, reason: 'execution_disabled' })
    }
  } catch {
    // Never expose database/credential diagnostics. Missing/malformed state also fails closed.
  }
  return NextResponse.json(
    { skipped: true, reason: 'execution_state_unavailable' },
    { status: 503 },
  )
}

/** Atomically admits one legacy request only while the legacy scope is enabled. */
export async function acquireEnrichmentExecutionAdmission(
  ttlSeconds: number,
): Promise<AdmissionResult> {
  const holder = `legacy:${crypto.randomUUID()}`
  const lockName = `${LEGACY_ADMISSION_PREFIX}${holder}`
  try {
    const { createAdminClient } = await import('@/lib/supabase/server')
    // Generated types intentionally lag the internal service-role RPC contract.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = createAdminClient() as any
    const { data, error } = await db.rpc('acquire_legacy_enrichment_admission', {
      p_holder: holder,
      p_ttl_seconds: ttlSeconds,
    })
    if (error) throw new Error('Execution admission unavailable')
    if (data === 'ADMITTED') return { admission: { holder, lockName }, response: null }
    if (data === 'DISABLED' || data === 'SCOPE_BLOCKED') {
      return {
        admission: null,
        response: NextResponse.json({ skipped: true, reason: 'execution_disabled' }),
      }
    }
  } catch {
    // Missing/malformed state and RPC failures deny admission without diagnostics leakage.
  }
  return {
    admission: null,
    response: NextResponse.json(
      { skipped: true, reason: 'execution_state_unavailable' },
      { status: 503 },
    ),
  }
}

export async function releaseEnrichmentExecutionAdmission(
  admission: EnrichmentExecutionAdmission,
): Promise<void> {
  const { createAdminClient } = await import('@/lib/supabase/server')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any
  try {
    await db.rpc('release_execution_lock', {
      p_lock_name: admission.lockName,
      p_holder: admission.holder,
    })
  } catch {
    // The lease is bounded; a failed release remains fail-safe until expiry.
  }
}
