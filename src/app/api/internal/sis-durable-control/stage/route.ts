import { NextResponse } from 'next/server'

import { callProviderJSON, type AIMessage } from '@/lib/ai/client'
import { acquireEnrichmentLock, releaseEnrichmentLock } from '@/lib/ai/execution-lock'
import { getModelChain } from '@/lib/ai/models'
import { isAuthorizedCronRequest } from '@/lib/security/cron-guard'
import { createAdminClient } from '@/lib/supabase/server'
import {
  DURABLE_SIS_V1_MAX_TOKENS,
  DURABLE_SIS_V1_STAGE_DEADLINE_MS,
  assertSafeDiagnostic,
  budgetReservationFor,
  invokeOneProvider,
  nextModel,
  safeDiagnostic,
} from '@/modules/signals/durable-sis-v1'
import {
  ENRICHMENT_SYSTEM_PROMPT,
  EnrichmentOutputSchema,
  buildEnrichmentPrompt,
  type EnrichmentOutput,
} from '@/modules/signals/enrichment-prompt'
import { computeAllScores, computeMomentumScore } from '@/modules/signals/scoring'
import {
  SISOutputSchema,
  SIS_SYSTEM_PROMPT,
  buildSISPrompt,
  computeSIS,
} from '@/modules/signals/strategic-score'
import { validateSignal } from '@/modules/signals/validation'
import type { ModelRef } from '@/lib/ai/config'
import type { ObservationRow } from '@/modules/observations/queries'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

type RpcClient = {
  rpc: (
    name: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>
  from: (table: string) => any // eslint-disable-line @typescript-eslint/no-explicit-any
}

interface Claim {
  message_id: number
  attempt_id: string
  run_id: string
  observation_id: string
  stage: 'CLASSIFIER' | 'PARSER'
  ordinal: number
  provider: ModelRef['provider']
  model: string
  redelivered: boolean
}

function candidateCategory(title: string, content: string): EnrichmentOutput['category'] {
  const text = `${title} ${content.slice(0, 500)}`.toLowerCase()
  const rules: Array<[EnrichmentOutput['category'], string[]]> = [
    ['REGULATION', ['regulation', 'policy', 'law']],
    ['FUNDING', ['funding', 'raises', 'investment']],
    ['MODELS', ['model', 'llm', 'gpt', 'weights']],
    ['AGENTS', ['agent', 'agentic']],
    ['INFRASTRUCTURE', ['api', 'cloud', 'compute']],
    ['HARDWARE', ['chip', 'gpu', 'semiconductor']],
    ['OPEN_SOURCE', ['open source', 'open-source']],
    ['COMPANIES', ['acqui', 'partnership', 'launch']],
  ]
  return rules.find(([, words]) => words.some((word) => text.includes(word)))?.[0] ?? 'RESEARCH'
}

function decisionPayload(
  result: Record<string, any>, // eslint-disable-line @typescript-eslint/no-explicit-any
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const dimensions = (result['sis'] ?? {}) as Record<string, unknown>
  return {
    sis_novelty: dimensions['novelty'] ?? null,
    sis_importance: dimensions['importance'] ?? null,
    sis_urgency: dimensions['urgency'] ?? null,
    sis_confidence: dimensions['confidence'] ?? null,
    sis_final: dimensions['final'] ?? null,
    human_relevance: result['human_relevance'] ?? {},
    anti_hype_score: result['anti_hype_score'] ?? null,
    anti_hype_flags: { flags: result['anti_hype_flags'] ?? [] },
    relevance_horizon: result['relevance_horizon'] ?? null,
    engine_justification: result['engine_justification'] ?? null,
    ...extra,
  }
}

async function complete(
  db: RpcClient,
  claim: Claim,
  args: Record<string, unknown>,
): Promise<{ data: unknown; error: { message: string } | null }> {
  return db.rpc('complete_durable_sis_v1_attempt', {
    p_attempt_id: claim.attempt_id,
    p_message_id: claim.message_id,
    p_status: 'SUCCEEDED',
    p_safe_diagnostic: null,
    p_validated_output: null,
    p_next_stage: null,
    p_next_provider: null,
    p_next_model: null,
    p_next_units: null,
    p_next_unit_kind: null,
    ...args,
  })
}

async function finalizeDiscard(
  db: RpcClient,
  claim: Claim,
  decision: Record<string, unknown>,
): Promise<void> {
  const { error } = await db.rpc('finalize_durable_sis_v1', {
    p_run_id: claim.run_id,
    p_outcome: 'DISCARD',
    p_signal: {},
    p_decision: decision,
  })
  if (error) throw new Error('Finalization failed')
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const db = createAdminClient() as never as RpcClient
  const holder = `durable-sis-v1:${crypto.randomUUID()}`
  if (!(await acquireEnrichmentLock(db, holder))) {
    return NextResponse.json({ attempted: 0, status: 'LOCKED' }, { status: 409 })
  }

  try {
    const { data: claimData, error: claimError } = await db.rpc('claim_durable_sis_v1_attempt', {
      p_visibility_seconds: 55,
    })
    if (claimError)
      return NextResponse.json({ attempted: 0, status: 'CLAIM_FAILED' }, { status: 503 })
    const claim = (Array.isArray(claimData) ? claimData[0] : null) as Claim | undefined
    if (!claim) return NextResponse.json({ attempted: 0, status: 'EMPTY' })

    const ref: ModelRef = { provider: claim.provider, model: claim.model }
    const { data: observationData, error: observationError } = await db
      .from('observations')
      .select('*')
      .eq('id', claim.observation_id)
      .single()
    if (observationError || !observationData) throw new Error('Observation unavailable')
    const observation = observationData as ObservationRow
    const { data: source } = await db
      .from('sources')
      .select('name, source_type, trust_score')
      .eq('id', observation.source_id)
      .single()
    const sourceName = source?.name ?? 'Unknown Source'
    const sourceType = source?.source_type ?? ''

    const classifierMessages: AIMessage[] = [
      { role: 'system', content: SIS_SYSTEM_PROMPT },
      {
        role: 'user',
        content: buildSISPrompt(observation.title, observation.content, sourceName, sourceType),
      },
    ]
    const parserMessages: AIMessage[] = [
      { role: 'system', content: ENRICHMENT_SYSTEM_PROMPT },
      {
        role: 'user',
        content: buildEnrichmentPrompt({
          title: observation.title,
          content: observation.content,
          sourceUrl: observation.url,
          sourceName,
          sourceTrustScore: source?.trust_score ?? 0.5,
          candidateCategory: candidateCategory(observation.title, observation.content),
          recentSignalTitles: [],
        }),
      },
    ]
    const messages = claim.stage === 'CLASSIFIER' ? classifierMessages : parserMessages
    if (claim.redelivered) {
      const chain = getModelChain(claim.stage === 'CLASSIFIER' ? 'classifier' : 'parser')
      const fallback = nextModel(chain, ref)
      const diagnostic = {
        type: 'delivery_uncertain' as const,
        provider: ref.provider,
        model: ref.model,
        http_status: 0,
        finish_reason: null,
        content_length: 0,
      }
      const fallbackReservation = fallback ? budgetReservationFor(messages, fallback) : null
      const completed = await complete(db, claim, {
        p_status: fallback ? 'DELIVERY_UNCERTAIN' : 'TERMINAL',
        p_safe_diagnostic: diagnostic,
        ...(fallback
          ? {
              p_next_stage: claim.stage,
              p_next_provider: fallback.provider,
              p_next_model: fallback.model,
              p_next_units: fallbackReservation?.units,
              p_next_unit_kind: fallbackReservation?.unitKind,
            }
          : {}),
      })
      if (completed.error) throw new Error('Redelivery recovery commit failed')
      if (!fallback) {
        await finalizeDiscard(db, claim, {
          rejection_code: 'R-15',
          rejection_reason: `Durable SIS ${claim.stage.toLowerCase()} delivery outcome was uncertain`,
          engine_justification: 'No provider was called twice after an uncertain delivery.',
        })
      }
      return NextResponse.json({
        attempted: 0,
        status: fallback ? 'QUEUED' : 'FINALIZED',
        diagnostic: diagnostic.type,
      })
    }
    try {
      const deadlineAt = Date.now() + DURABLE_SIS_V1_STAGE_DEADLINE_MS
      if (claim.stage === 'CLASSIFIER') {
        const rawResult = await invokeOneProvider(() =>
          callProviderJSON(
            ref,
            messages,
            SISOutputSchema,
            { maxTokens: DURABLE_SIS_V1_MAX_TOKENS, temperature: 0 },
            deadlineAt,
          ),
        )
        const raw = SISOutputSchema.parse(rawResult)
        const sis = computeSIS(raw, observation.title, observation.content)
        if (sis.decision === 'DISCARD' || sis.decision === 'ARCHIVE') {
          await complete(db, claim, { p_validated_output: sis })
          await finalizeDiscard(
            db,
            claim,
            decisionPayload(sis, {
              rejection_code: 'R-09',
              rejection_reason: `SIS ${sis.sis.final} classified ${sis.decision}`,
            }),
          )
          return NextResponse.json({ attempted: 1, status: 'FINALIZED', outcome: 'DISCARD' })
        }
        const parser = getModelChain('parser')[0]
        if (!parser) throw new Error('Parser unavailable')
        const parserReservation = budgetReservationFor(parserMessages, parser)
        const completed = await complete(db, claim, {
          p_validated_output: sis,
          p_next_stage: 'PARSER',
          p_next_provider: parser.provider,
          p_next_model: parser.model,
          p_next_units: parserReservation.units,
          p_next_unit_kind: parserReservation.unitKind,
        })
        if (completed.error) throw new Error('Stage commit failed')
        return NextResponse.json({ attempted: 1, status: 'QUEUED', stage: 'PARSER' })
      }

      const enrichedResult = await invokeOneProvider(() =>
        callProviderJSON(
          ref,
          messages,
          EnrichmentOutputSchema,
          { maxTokens: DURABLE_SIS_V1_MAX_TOKENS, temperature: 0 },
          deadlineAt,
        ),
      )
      const enriched = EnrichmentOutputSchema.parse(enrichedResult)
      const { data: run } = await db
        .from('sis_execution_runs')
        .select('classifier_output')
        .eq('id', claim.run_id)
        .single()
      const sis = run?.classifier_output as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
      const factors = { ...enriched, consistency_factor: 7 }
      const scores = computeAllScores(factors)
      const validation = validateSignal({
        title: enriched.title,
        description: enriched.description,
        ...scores,
        category: enriched.category,
        observation_ids: [observation.id],
        entities: enriched.entities.map((entity) => ({
          name: entity.name,
          type: String(entity.type ?? 'UNKNOWN'),
        })),
      })
      const rejection = enriched.is_marketing
        ? ['R-14', 'Marketing content']
        : enriched.is_duplicate
          ? ['R-11', enriched.duplicate_note ?? 'Duplicate']
          : !validation.valid
            ? ['R-15', validation.rejectionReason ?? 'Validation failed']
            : null
      await complete(db, claim, { p_validated_output: enriched })
      if (rejection) {
        await finalizeDiscard(
          db,
          claim,
          decisionPayload(sis, {
            rejection_code: rejection[0],
            rejection_reason: rejection[1],
            engine_justification: rejection[1],
          }),
        )
        return NextResponse.json({ attempted: 1, status: 'FINALIZED', outcome: 'DISCARD' })
      }
      const outcome = sis?.decision === 'WEAK_SIGNAL' ? 'WEAK_SIGNAL' : 'SIGNAL'
      const signal = {
        ...enriched,
        ...scores,
        momentum_score: computeMomentumScore({
          newObservationsCount: 1,
          distinctSourceCount: 1,
          crossCategoryRefCount: 0,
          daysSinceCreation: 0,
        }),
      }
      const finalized = await db.rpc('finalize_durable_sis_v1', {
        p_run_id: claim.run_id,
        p_outcome: outcome,
        p_signal: signal,
        p_decision: decisionPayload(sis),
      })
      if (finalized.error) throw new Error('Finalization failed')
      return NextResponse.json({ attempted: 1, status: 'FINALIZED', outcome })
    } catch (error) {
      const diagnostic = safeDiagnostic(error, ref)
      assertSafeDiagnostic(diagnostic)
      const chain = getModelChain(claim.stage === 'CLASSIFIER' ? 'classifier' : 'parser')
      const fallback = nextModel(chain, ref)
      const fallbackReservation = fallback ? budgetReservationFor(messages, fallback) : null
      const completed = await complete(db, claim, {
        p_status: fallback ? 'RETRYABLE' : 'TERMINAL',
        p_safe_diagnostic: diagnostic,
        ...(fallback
          ? {
              p_next_stage: claim.stage,
              p_next_provider: fallback.provider,
              p_next_model: fallback.model,
              p_next_units: fallbackReservation?.units,
              p_next_unit_kind: fallbackReservation?.unitKind,
            }
          : {}),
      })
      if (completed.error) throw new Error('Failure commit failed')
      if (!fallback) {
        await finalizeDiscard(db, claim, {
          rejection_code: 'R-15',
          rejection_reason: `Durable SIS ${claim.stage.toLowerCase()} exhausted provider chain`,
          engine_justification: 'All bounded provider attempts ended in typed failures.',
        })
      }
      return NextResponse.json({
        attempted: 1,
        status: fallback ? 'QUEUED' : 'FINALIZED',
        diagnostic: diagnostic.type,
      })
    }
  } finally {
    await releaseEnrichmentLock(db, holder)
  }
}
