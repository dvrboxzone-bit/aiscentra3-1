import { NextResponse } from 'next/server'

import { processBatchOfObservations, type BatchProcessingDeps } from '@/app/api/enrich/batch/route'
import { acquireEnrichmentLock, releaseEnrichmentLock } from '@/lib/ai/execution-lock'
import { AIStructuredOutputChainError } from '@/lib/ai/structured-output'
import { isAuthorizedCronRequest } from '@/lib/security/cron-guard'
import { createAdminClient } from '@/lib/supabase/server'
import {
  markObservationForRetry,
  markObservationProcessed,
  type ObservationRow,
} from '@/modules/observations/queries'
import { processObservation, type SignalEngineResult } from '@/modules/signals/engine'
import {
  parseTargetedReplayRequest,
  runTargetedSisReplay,
  TARGETED_SIS_REPAIR_KEY,
  TARGETED_SIS_REPLAY_V2_AUDIT_FIELD,
  TARGETED_SIS_REPLAY_V2_KEY,
  TARGETED_SIS_REPLAY_V2_MARKER_FIELD,
  type StructuredFailureType,
  type TargetedReplayItemResult,
} from '@/modules/signals/targeted-sis-replay'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

const DEADLINE_BUFFER_MS = 10_000

function diagnosticFromResult(result: SignalEngineResult): StructuredFailureType | undefined {
  if (result.outcome !== 'error') return undefined
  const match = result.reason?.match(
    /SIS structured output: (json_parse|schema_validation|output_truncated|invalid_response_envelope)/,
  )
  return match?.[1] as StructuredFailureType | undefined
}

async function processClaimedObservation(
  supabase: ReturnType<typeof createAdminClient>,
  observation: ObservationRow,
  deadlineAt: number,
): Promise<TargetedReplayItemResult> {
  let diagnostic: StructuredFailureType | undefined
  // The generated Database type on this historical branch predates the
  // columns used by this internal repair path; keep the same deliberately
  // loose server-only convention as the existing enrichment route.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any

  const deps: BatchProcessingDeps = {
    fetchSourceInfo: async (sourceId) => {
      const { data, error } = await db
        .from('sources')
        .select('name, trust_score')
        .eq('id', sourceId)
        .single()
      if (error) return { ok: false, trustScore: 0, sourceName: '', error: error.message }
      return {
        ok: true,
        trustScore: data?.trust_score ?? 0.5,
        sourceName: data?.name ?? 'Unknown Source',
      }
    },
    // Fail loudly if a future refactor tries to turn this targeted path into
    // a general queue drain. processBatchOfObservations never calls this
    // dependency for its already-fetched input rows.
    fetchObservationsPage: async () => {
      throw new Error('General observation queue access is forbidden in targeted SIS replay')
    },
    processObservation: async (...args) => {
      try {
        const result = await processObservation(...args)
        diagnostic = diagnosticFromResult(result)
        return result
      } catch (error) {
        if (error instanceof AIStructuredOutputChainError) {
          diagnostic = error.failureType
        }
        throw error
      }
    },
    markObservationProcessed,
    markObservationForRetry: (id, delay, _client, metadata) =>
      markObservationForRetry(id, delay, supabase as never, metadata),
  }

  const stats = await processBatchOfObservations([observation], deadlineAt, deps)
  const disposition =
    stats.succeeded === 1
      ? 'valid'
      : stats.rejected === 1
        ? 'rejected'
        : stats.retried === 1
          ? 'retried'
          : 'failed'

  return diagnostic ? { disposition, diagnostic } : { disposition }
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = parseTargetedReplayRequest(body)
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }

  const startedAt = Date.now()
  const deadlineAt = startedAt + maxDuration * 1000 - DEADLINE_BUFFER_MS
  const supabase = createAdminClient()
  // See processClaimedObservation: generated database types lag this
  // server-only repair contract, while runtime schema is release-gated.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any
  const lockHolder = `targeted-sis-replay:${startedAt}:${crypto.randomUUID()}`
  const lockClient = supabase as never
  const gotLock = await acquireEnrichmentLock(lockClient, lockHolder)
  if (!gotLock) {
    return NextResponse.json(
      { skipped: true, reason: 'enrichment_already_running' },
      { status: 409 },
    )
  }

  try {
    const summary = await runTargetedSisReplay(parsed.observationIds, deadlineAt, {
      loadEligible: async (ids) => {
        const { data, error } = await db
          .from('observations')
          .select('*')
          .in('id', [...ids])
        if (error) throw new Error('Targeted observation read failed')
        return (data ?? []) as ObservationRow[]
      },
      claim: async (observation) => {
        const metadata = {
          ...(observation.metadata ?? {}),
          [TARGETED_SIS_REPLAY_V2_MARKER_FIELD]: TARGETED_SIS_REPLAY_V2_KEY,
          [TARGETED_SIS_REPLAY_V2_AUDIT_FIELD]: {
            reason: 'Approved one-time v2 replay after increasing only the SIS output cap',
            claimed_at: new Date().toISOString(),
            source: 'internal_allowlisted_sis_replay_v2',
          },
        }
        const { data, error } = await db
          .from('observations')
          .update({ metadata })
          .eq('id', observation.id)
          .eq('processed', false)
          .is('processing_error', null)
          .is('signal_id', null)
          .is('rejection_code', null)
          .eq('metadata->>repair_key', TARGETED_SIS_REPAIR_KEY)
          .is(`metadata->>${TARGETED_SIS_REPLAY_V2_MARKER_FIELD}`, null)
          .select('*')
          .maybeSingle()
        if (error) throw new Error('Targeted observation claim failed')
        return (data as ObservationRow | null) ?? null
      },
      processOne: (observation, itemDeadlineAt) =>
        processClaimedObservation(supabase, observation, itemDeadlineAt),
    })

    return NextResponse.json(
      {
        ...summary,
        duration_ms: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      },
      { status: summary.complete ? 200 : 503 },
    )
  } catch (error) {
    console.error(
      '[internal/sis-replay] failed:',
      error instanceof Error ? error.message : 'Unknown targeted replay failure',
    )
    return NextResponse.json({ error: 'Targeted SIS replay failed' }, { status: 500 })
  } finally {
    await releaseEnrichmentLock(lockClient, lockHolder)
  }
}
