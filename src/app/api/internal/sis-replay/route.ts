import { NextResponse } from 'next/server'

import { processBatchOfObservations, type BatchProcessingDeps } from '@/app/api/enrich/batch/route'
import {
  acquireEnrichmentLock,
  releaseEnrichmentLock,
  verifyEnrichmentLockLease,
} from '@/lib/ai/execution-lock'
import {
  TARGETED_SIS_V3_CLASSIFIER_POLICY,
  TARGETED_SIS_V3_PARSER_POLICY,
  TARGETED_SIS_V3_PREFLIGHT_ESTIMATED_TOKENS,
  hasTargetedSisV3PreclaimBudget,
  TARGETED_SIS_V4_CLASSIFIER_POLICY,
  TARGETED_SIS_V4_PARSER_POLICY,
  buildLockScopedTPMAvailability,
  createTargetedSisV4ReservationPlan,
  type TargetedSisV4ReservationPlan,
} from '@/lib/ai/execution-policy'
import { structuredFailureTypesFromExecutionDiagnostics } from '@/lib/ai/execution-diagnostics'
import { AIDeadlineExceededError } from '@/lib/ai/deadline'
import { getModelChain } from '@/lib/ai/models'
import { AIStructuredOutputChainError } from '@/lib/ai/structured-output'
import { checkTPMBudget, getModelTPMCapacity } from '@/lib/ai/tpm-manager'
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
  parseTargetedReplayV4ControlRequest,
  runTargetedSisReplay,
  TARGETED_SIS_REPAIR_KEY,
  TARGETED_SIS_REPLAY_V2_AUDIT_FIELD,
  TARGETED_SIS_REPLAY_V2_KEY,
  TARGETED_SIS_REPLAY_V2_MARKER_FIELD,
  TARGETED_SIS_REPLAY_V3_CONTROL_AUDIT_FIELD,
  TARGETED_SIS_REPLAY_V3_CONTROL_KEY,
  TARGETED_SIS_REPLAY_V3_CONTROL_MARKER_FIELD,
  isTargetedReplayV3ControlEligible,
  isTargetedReplayV4ControlEligible,
  TARGETED_SIS_REPLAY_V4_CONTROL_AUDIT_FIELD,
  TARGETED_SIS_REPLAY_V4_CONTROL_KEY,
  TARGETED_SIS_REPLAY_V4_CONTROL_MARKER_FIELD,
  type StructuredFailureType,
  type TargetedReplayItemResult,
} from '@/modules/signals/targeted-sis-replay'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

const DEADLINE_BUFFER_MS = 10_000
const CAMPAIGN_HEADER = 'x-sis-replay-campaign'

type ControlCampaign = 'v3' | 'v4' | undefined

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
  campaign: ControlCampaign = undefined,
  v4Reservation?: TargetedSisV4ReservationPlan,
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
          campaign === 'v4' && v4Reservation
            ? {
                classifier: {
                  ...TARGETED_SIS_V4_CLASSIFIER_POLICY,
                  reservedModels: v4Reservation.classifierModels,
                },
                parser: {
                  ...TARGETED_SIS_V4_PARSER_POLICY,
                  reservedModels: v4Reservation.parserModels,
                },
              }
            : campaign === 'v3'
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

  const campaignHeader = request.headers.get(CAMPAIGN_HEADER)
  const campaign: ControlCampaign =
    campaignHeader === TARGETED_SIS_REPLAY_V4_CONTROL_KEY
      ? 'v4'
      : campaignHeader === TARGETED_SIS_REPLAY_V3_CONTROL_KEY
        ? 'v3'
        : undefined
  const parsed =
    campaign === 'v4'
      ? parseTargetedReplayV4ControlRequest(body)
      : campaign === 'v3'
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
    const v4Reservations = new Map<string, TargetedSisV4ReservationPlan>()
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
        const markerField =
          campaign === 'v4'
            ? TARGETED_SIS_REPLAY_V4_CONTROL_MARKER_FIELD
            : campaign === 'v3'
              ? TARGETED_SIS_REPLAY_V3_CONTROL_MARKER_FIELD
              : TARGETED_SIS_REPLAY_V2_MARKER_FIELD
        const markerKey =
          campaign === 'v4'
            ? TARGETED_SIS_REPLAY_V4_CONTROL_KEY
            : campaign === 'v3'
              ? TARGETED_SIS_REPLAY_V3_CONTROL_KEY
              : TARGETED_SIS_REPLAY_V2_KEY
        const auditField =
          campaign === 'v4'
            ? TARGETED_SIS_REPLAY_V4_CONTROL_AUDIT_FIELD
            : campaign === 'v3'
              ? TARGETED_SIS_REPLAY_V3_CONTROL_AUDIT_FIELD
              : TARGETED_SIS_REPLAY_V2_AUDIT_FIELD
        const metadata = {
          ...(observation.metadata ?? {}),
          [markerField]: markerKey,
          [auditField]: {
            reason:
              campaign === 'v4'
                ? 'Approved v4 lock-scoped reservation control checkpoint for one observation'
                : campaign === 'v3'
                  ? 'Approved v3 scheduling control checkpoint for one observation'
                  : 'Approved one-time v2 replay after increasing only the SIS output cap',
            claimed_at: new Date().toISOString(),
            source:
              campaign === 'v4'
                ? 'internal_allowlisted_sis_replay_v4_control'
                : campaign === 'v3'
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
        processClaimedObservation(
          supabase,
          observation,
          itemDeadlineAt,
          campaign,
          v4Reservations.get(observation.id),
        ),
      ...(campaign === 'v4'
        ? {
            isEligible: isTargetedReplayV4ControlEligible,
            canStart: async (observation: ObservationRow, itemDeadlineAt: number) => {
              const leaseVerified = await verifyEnrichmentLockLease(db, lockHolder, itemDeadlineAt)
              if (!leaseVerified) return false
              const classifierChain = getModelChain('classifier')
              const parserChain = getModelChain('parser')
              const models = [
                ...new Set([...classifierChain, ...parserChain].map((ref) => ref.model)),
              ]
              const { data: usageRows, error: usageError } = await db
                .from('ai_token_usage')
                .select('model, tokens')
                .in('model', models)
                .gte('consumed_at', new Date(Date.now() - 60_000).toISOString())
              if (usageError || !Array.isArray(usageRows)) return false
              const availability = buildLockScopedTPMAvailability({
                models,
                rows: usageRows,
                capacityForModel: getModelTPMCapacity,
              })
              if (!availability) return false
              const reservation = createTargetedSisV4ReservationPlan({
                remainingMs: itemDeadlineAt - Date.now(),
                lockLeaseVerified: true,
                classifierChain,
                parserChain,
                estimatedTokens: TARGETED_SIS_V3_PREFLIGHT_ESTIMATED_TOKENS,
                checkTPM: (model, estimatedTokens) => {
                  const shared = availability.get(model)
                  const local = checkTPMBudget(model, estimatedTokens)
                  if (!shared) return { allowed: false, remainingTokens: 0 }
                  return {
                    allowed: shared.allowed && local.allowed,
                    remainingTokens: Math.min(shared.remainingTokens, local.remainingTokens),
                  }
                },
              })
              if (!reservation) return false
              v4Reservations.set(observation.id, reservation)
              return true
            },
          }
        : campaign === 'v3'
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

    const finalEligible = campaign
      ? (await loadRows(parsed.observationIds)).filter((row) =>
          campaign === 'v4'
            ? isTargetedReplayV4ControlEligible(row)
            : isTargetedReplayV3ControlEligible(row),
        ).length
      : undefined

    return NextResponse.json(
      {
        ...summary,
        ...(campaign ? { initial_eligible: summary.eligible, final_eligible: finalEligible } : {}),
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
