import { NextResponse } from 'next/server'

// Same control row used by Durable SIS start/claim. No independent flag or cache.
export const ENRICHMENT_CONTROL_KEY = 'durable_sis_v1_control_20260825'

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
