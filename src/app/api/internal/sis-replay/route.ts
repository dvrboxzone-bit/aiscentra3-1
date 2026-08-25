import { NextResponse } from 'next/server'

import { processBatchOfObservations, type BatchProcessingDeps } from '@/app/api/enrich/batch/route'
import { acquireEnrichmentLock, releaseEnrichmentLock } from '@/lib/ai/execution-lock'
import {
  TARGETED_SIS_V3_CLASSIFIER_POLICY,
  TARGETED_SIS_V3_PARSER_POLICY,
  TARGETED_SIS_V3_PREFLIGHT_ESTIMATED_TOKENS,
  hasTargetedSisV3PreclaimBudget,
} from '@/lib/ai/execution-policy'
import { structuredFailureTypesFromExecutionDiagnostics } from '@/lib/ai/execution-diagnostics'
import { AIDeadlineExceededError } from '@/lib/ai/deadline'
import { getModelChain } from '@/lib/ai/models'
import { AIStructuredOutputChainError } from '@/lib/ai/structured-output'
import { checkTPMBudget } from '@/lib/ai/tpm-manager'
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
  parseTargetedReplayV3ControlRequest,
  runTargetedSisReplay,
  TARGETED_SIS_REPAIR_KEY,
  TARGETED_SIS_REPLAY_V2_AUDIT_FIELD,
  TARGETED_SIS_REPLAY_V2_KEY,
  TARGETED_SIS_REPLAY_V2_MARKER_FIELD,
  TARGETED_SIS_REPLAY_V3_CONTROL_AUDIT_FIELD,
  TARGETED_SIS_REPLAY_V3_CONTROL_KEY,
  TARGETED_SIS_REPLAY_V3_CONTROL_MARKER_FIELD,
  isTargetedReplayV3ControlEligible,
  type StructuredFailureType,
  type TargetedReplayItemResult,
} from '@/modules/signals/targeted-sis-replay'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

const DEADLINE_BUFFER_MS = 10_000
const V3_CAMPAIGN_HEADER = 'x-sis-replay-campaign'

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
  useV3ExecutionPolicy = false,
): Promise<TargetedReplayItemResult> {
  let diagnostic: StructuredFailureType | undefined
  let deadlineError: AIDeadlineExceededError | undefined
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
    processObservation: async (row, trustScore, sourceName, sourceType, itemDeadlineAt) => {
      try {
        const result = await processObservation(
          row,
          trustScore,
          sourceName,
          sourceType,
          itemDeadlineAt,
          useV3ExecutionPolicy
            ? {
                classifier: TARGETED_SIS_V3_CLASSIFIER_POLICY,
                parser: TARGETED_SIS_V3_PARSER_POLICY,
              }
            : undefined,
        )
        diagnostic = diagnosticFromResult(result)
        return result
      } catch (error) {
        if (error instanceof AIStructuredOutputChainError) {
          diagnostic = error.failureType
        }
        if (error instanceof AIDeadlineExceededError) deadlineError = error
        throw error
      }
    },
    markObservationProcessed,
    markObservationForRetry: (id, delay, _client, metadata) =>
      markObservationForRetry(id, delay, supabase as never, {
        ...metadata,
        ...(deadlineError
          ? {
              targeted_sis_deadline_last_failure: {
                context: deadlineError.context,
                diagnostics: deadlineError.diagnostics,
                recorded_at: new Date().toISOString(),
              },
            }
          : {}),
      }),
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

  const diagnostics = deadlineError
    ? structuredFailureTypesFromExecutionDiagnostics(deadlineError.diagnostics)
    : []
  if (diagnostic) diagnostics.push(diagnostic)
  return {
    disposition,
    ...(diagnostics.length > 0 ? { diagnostics } : {}),
    ...(deadlineError ? { deadlineExceeded: true } : {}),
  }
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

  const isV3Control = request.headers.get(V3_CAMPAIGN_HEADER) === TARGETED_SIS_REPLAY_V3_CONTROL_KEY
  const parsed = isV3Control
    ? parseTargetedReplayV3ControlRequest(body)
    : parseTargetedReplayRequest(body)
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
    const loadRows = async (ids: readonly string[]): Promise<ObservationRow[]> => {
      const { data, error } = await db
        .from('observations')
        .select('*')
        .in('id', [...ids])
      if (error) throw new Error('Targeted observation read failed')
      return (data ?? []) as ObservationRow[]
    }

    const summary = await runTargetedSisReplay(parsed.observationIds, deadlineAt, {
      loadEligible: async (ids) => {
        return loadRows(ids)
      },
      claim: async (observation) => {
        const markerField = isV3Control
          ? TARGETED_SIS_REPLAY_V3_CONTROL_MARKER_FIELD
          : TARGETED_SIS_REPLAY_V2_MARKER_FIELD
        const markerKey = isV3Control
          ? TARGETED_SIS_REPLAY_V3_CONTROL_KEY
          : TARGETED_SIS_REPLAY_V2_KEY
        const auditField = isV3Control
          ? TARGETED_SIS_REPLAY_V3_CONTROL_AUDIT_FIELD
          : TARGETED_SIS_REPLAY_V2_AUDIT_FIELD
        const metadata = {
          ...(observation.metadata ?? {}),
          [markerField]: markerKey,
          [auditField]: {
            reason: isV3Control
              ? 'Approved v3 scheduling control checkpoint for one observation'
              : 'Approved one-time v2 replay after increasing only the SIS output cap',
            claimed_at: new Date().toISOString(),
            source: isV3Control
              ? 'internal_allowlisted_sis_replay_v3_control'
              : 'internal_allowlisted_sis_replay_v2',
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
          .is(`metadata->>${markerField}`, null)
          .select('*')
          .maybeSingle()
        if (error) throw new Error('Targeted observation claim failed')
        return (data as ObservationRow | null) ?? null
      },
      processOne: (observation, itemDeadlineAt) =>
        processClaimedObservation(supabase, observation, itemDeadlineAt, isV3Control),
      ...(isV3Control
        ? {
            isEligible: isTargetedReplayV3ControlEligible,
            canStart: async (_observation: ObservationRow, itemDeadlineAt: number) => {
              const classifier = getModelChain('classifier')[0]
              const parser = getModelChain('parser')[0]
              if (!classifier || !parser) return false
              return hasTargetedSisV3PreclaimBudget({
                remainingMs: itemDeadlineAt - Date.now(),
                classifierTPMAllowed: checkTPMBudget(
                  classifier.model,
                  TARGETED_SIS_V3_PREFLIGHT_ESTIMATED_TOKENS,
                ).allowed,
                parserTPMAllowed: checkTPMBudget(
                  parser.model,
                  TARGETED_SIS_V3_PREFLIGHT_ESTIMATED_TOKENS,
                ).allowed,
              })
            },
          }
        : {}),
    })

    const finalEligible = isV3Control
      ? (await loadRows(parsed.observationIds)).filter((row) =>
          isTargetedReplayV3ControlEligible(row),
        ).length
      : undefined

    return NextResponse.json(
      {
        ...summary,
        ...(isV3Control
          ? { initial_eligible: summary.eligible, final_eligible: finalEligible }
          : {}),
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
