import { NextResponse } from 'next/server'

import { callProviderJSON, type AIMessage } from '@/lib/ai/client'
import { acquireEnrichmentLock, releaseEnrichmentLock } from '@/lib/ai/execution-lock'
import { getModelChain } from '@/lib/ai/models'
import { isAuthorizedCronRequest } from '@/lib/security/cron-guard'
import { createAdminClient } from '@/lib/supabase/server'
import {
  DURABLE_SIS_V1_CLASSIFIER_MAX_TOKENS,
  DURABLE_SIS_V1_STAGE_DEADLINE_MS,
  assertSafeDiagnostic,
  budgetReservationFor,
  firstRunnableModel,
  invokeOneProvider,
  nextRunnableModel,
  safeDiagnostic,
} from '@/modules/signals/durable-sis-v1'
import { type EnrichmentOutput } from '@/modules/signals/enrichment-prompt'
import {
  DURABLE_SIS_V1_COMPACT_PARSER_INSTRUCTION,
  DURABLE_SIS_V1_PARSER_MAX_TOKENS,
  DurableSisParserOutputSchema,
  buildDurableSisParserPrompt,
  durableSisParserRequestOptions,
} from '@/modules/signals/durable-sis-parser-contract'
import { computeAllScores, computeMomentumScore } from '@/modules/signals/scoring'
import {
  SISOutputSchema,
  SIS_SYSTEM_PROMPT,
  buildSISPrompt,
  computeSIS,
} from '@/modules/signals/strategic-score'
import { validateSignal } from '@/modules/signals/validation'
import {
  assessPrimaryEvidencePolicyV1,
  primaryEvidencePromptContext,
} from '@/modules/signals/primary-evidence-policy'
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
  attempt_id: string | null
  run_id: string
  observation_id: string
  stage: 'CLASSIFIER' | 'PARSER' | 'FINALIZE'
  ordinal: number | null
  provider: ModelRef['provider'] | null
  model: string | null
  redelivered: boolean
}

interface ProviderClaim extends Claim {
  attempt_id: string
  stage: 'CLASSIFIER' | 'PARSER'
  ordinal: number
  provider: ModelRef['provider']
  model: string
}

interface CompletionResult {
  status: string
  stage?: 'CLASSIFIER' | 'PARSER' | 'FINALIZE'
  reason?: string
}

class DurableCommitError extends Error {}

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
  claim: ProviderClaim,
  args: Record<string, unknown>,
): Promise<CompletionResult> {
  const { data, error } = await db.rpc('complete_durable_sis_v1_attempt', {
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
    p_finalization_outcome: null,
    p_finalization_signal: null,
    p_finalization_decision: null,
    p_budget_unavailable_decision: null,
    ...args,
  })
  if (error || !data || typeof data !== 'object')
    throw new DurableCommitError('Stage commit failed')
  return data as CompletionResult
}

async function failStage(
  db: RpcClient,
  claim: ProviderClaim,
  args: {
    status: 'SUCCEEDED' | 'TERMINAL' | 'DELIVERY_UNCERTAIN'
    diagnostic: ReturnType<typeof safeDiagnostic>
    validatedOutput?: unknown
  },
): Promise<CompletionResult> {
  const { data, error } = await db.rpc('fail_durable_sis_v1_stage', {
    p_attempt_id: claim.attempt_id,
    p_message_id: claim.message_id,
    p_attempt_status: args.status,
    p_safe_diagnostic: args.diagnostic,
    p_validated_output: args.validatedOutput ?? null,
  })
  if (error || !data || typeof data !== 'object')
    throw new DurableCommitError('Stage failure commit failed')
  return data as CompletionResult
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

    if (claim.stage === 'FINALIZE') {
      const { data, error } = await db.rpc('finalize_durable_sis_v1', {
        p_run_id: claim.run_id,
        p_message_id: claim.message_id,
      })
      if (error) {
        return NextResponse.json({ attempted: 0, status: 'FINALIZE_RETRY' }, { status: 503 })
      }
      const result = (data ?? {}) as Record<string, unknown>
      return NextResponse.json({
        attempted: 0,
        status: 'FINALIZED',
        outcome: result['outcome'] ?? null,
        duplicate: result['duplicate'] === true,
      })
    }

    if (!claim.attempt_id || claim.ordinal === null || !claim.provider || !claim.model) {
      return NextResponse.json({ attempted: 0, status: 'INVALID_CLAIM' }, { status: 503 })
    }
    const providerClaim = claim as ProviderClaim

    const ref: ModelRef = { provider: providerClaim.provider, model: providerClaim.model }
    const { data: observationData, error: observationError } = await db
      .from('observations')
      .select('*')
      .eq('id', claim.observation_id)
      .single()
    if (observationError || !observationData) throw new Error('Observation unavailable')
    const observation = observationData as ObservationRow
    const { data: source } = await db
      .from('sources')
      .select('name, type, trust_score, url, status')
      .eq('id', observation.source_id)
      .single()
    const sourceName = source?.name ?? 'Unknown Source'
    const sourceType = source?.type ?? ''
    const evidencePolicy = primaryEvidencePromptContext(
      assessPrimaryEvidencePolicyV1({
        sourceId: observation.source_id,
        sourceUrl: source?.url ?? '',
        observationUrl: observation.url,
      }),
    )

    const classifierMessages: AIMessage[] = [
      { role: 'system', content: SIS_SYSTEM_PROMPT },
      {
        role: 'user',
        content: buildSISPrompt(
          observation.title,
          observation.content,
          sourceName,
          sourceType,
          evidencePolicy,
        ),
      },
    ]
    const parserMessages: AIMessage[] = [
      {
        role: 'system',
        content: DURABLE_SIS_V1_COMPACT_PARSER_INSTRUCTION,
      },
      {
        role: 'user',
        content: buildDurableSisParserPrompt({
          title: observation.title,
          content: observation.content,
          sourceName,
          sourceType,
          sourceTrustScore: source?.trust_score ?? 0.5,
          candidateCategory: candidateCategory(observation.title, observation.content),
          evidencePolicy,
        }),
      },
    ]
    const messages = providerClaim.stage === 'CLASSIFIER' ? classifierMessages : parserMessages
    const outputBudget =
      providerClaim.stage === 'CLASSIFIER'
        ? DURABLE_SIS_V1_CLASSIFIER_MAX_TOKENS
        : DURABLE_SIS_V1_PARSER_MAX_TOKENS
    if (providerClaim.redelivered) {
      const chain = getModelChain(providerClaim.stage === 'CLASSIFIER' ? 'classifier' : 'parser')
      const fallback = nextRunnableModel(chain, ref, messages, outputBudget)
      const diagnostic = {
        type: 'delivery_uncertain' as const,
        provider: ref.provider,
        model: ref.model,
        http_status: 0,
        finish_reason: null,
        content_length: 0,
      }
      assertSafeDiagnostic(diagnostic)
      if (!fallback) {
        await failStage(db, providerClaim, {
          status: 'DELIVERY_UNCERTAIN',
          diagnostic,
        })
        return NextResponse.json({
          attempted: 0,
          status: 'FAILED',
          stage: providerClaim.stage,
          diagnostic: diagnostic.type,
        })
      }
      const fallbackReservation = budgetReservationFor(messages, fallback, outputBudget)
      const completed = await complete(db, providerClaim, {
        p_status: 'DELIVERY_UNCERTAIN',
        p_safe_diagnostic: diagnostic,
        p_next_stage: providerClaim.stage,
        p_next_provider: fallback.provider,
        p_next_model: fallback.model,
        p_next_units: fallbackReservation.units,
        p_next_unit_kind: fallbackReservation.unitKind,
      })
      return NextResponse.json({
        attempted: 0,
        status: completed.status === 'FAILED' ? 'FAILED' : 'QUEUED',
        stage: completed.stage ?? providerClaim.stage,
        diagnostic: completed.reason ?? diagnostic.type,
      })
    }
    try {
      const deadlineAt = Date.now() + DURABLE_SIS_V1_STAGE_DEADLINE_MS
      if (providerClaim.stage === 'CLASSIFIER') {
        const rawResult = await invokeOneProvider(() =>
          callProviderJSON(
            ref,
            messages,
            SISOutputSchema,
            { maxTokens: DURABLE_SIS_V1_CLASSIFIER_MAX_TOKENS, temperature: 0 },
            deadlineAt,
          ),
        )
        const raw = SISOutputSchema.parse(rawResult)
        const sis = computeSIS(raw, observation.title, observation.content)
        if (sis.decision === 'DISCARD') {
          await complete(db, providerClaim, {
            p_validated_output: sis,
            p_finalization_outcome: 'DISCARD',
            p_finalization_signal: {},
            p_finalization_decision: decisionPayload(sis, {
              rejection_code: 'R-09',
              rejection_reason: `SIS ${sis.sis.final} classified ${sis.decision}`,
            }),
          })
          return NextResponse.json({ attempted: 1, status: 'QUEUED', stage: 'FINALIZE' })
        }
        const parserChain = getModelChain('parser')
        const parser = firstRunnableModel(
          parserChain,
          parserMessages,
          DURABLE_SIS_V1_PARSER_MAX_TOKENS,
        )
        if (!parser) {
          const unavailableRef = parserChain[0] ?? ref
          const diagnostic = {
            type: 'budget_unavailable' as const,
            provider: unavailableRef.provider,
            model: unavailableRef.model,
            http_status: 0,
            finish_reason: null,
            content_length: 0,
          }
          await failStage(db, providerClaim, {
            status: 'SUCCEEDED',
            diagnostic,
            validatedOutput: sis,
          })
          return NextResponse.json({
            attempted: 1,
            status: 'FAILED',
            stage: 'PARSER',
            diagnostic: diagnostic.type,
          })
        }
        const parserReservation = budgetReservationFor(
          parserMessages,
          parser,
          DURABLE_SIS_V1_PARSER_MAX_TOKENS,
        )
        const completed = await complete(db, providerClaim, {
          p_validated_output: sis,
          p_next_stage: 'PARSER',
          p_next_provider: parser.provider,
          p_next_model: parser.model,
          p_next_units: parserReservation.units,
          p_next_unit_kind: parserReservation.unitKind,
        })
        return NextResponse.json({
          attempted: 1,
          status: completed.status === 'FAILED' ? 'FAILED' : 'QUEUED',
          stage: completed.stage ?? 'PARSER',
          diagnostic: completed.reason ?? null,
        })
      }

      const enrichedResult = await invokeOneProvider(() =>
        callProviderJSON(
          ref,
          messages,
          DurableSisParserOutputSchema,
          {
            maxTokens: DURABLE_SIS_V1_PARSER_MAX_TOKENS,
            temperature: 0,
            ...durableSisParserRequestOptions(ref.provider),
          },
          deadlineAt,
        ),
      )
      const enriched = DurableSisParserOutputSchema.parse(enrichedResult)
      const { data: run } = await db
        .from('sis_execution_runs')
        .select('classifier_output')
        .eq('id', providerClaim.run_id)
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
      if (rejection) {
        await complete(db, providerClaim, {
          p_validated_output: enriched,
          p_finalization_outcome: 'DISCARD',
          p_finalization_signal: {},
          p_finalization_decision: decisionPayload(sis, {
            rejection_code: rejection[0],
            rejection_reason: rejection[1],
            engine_justification: rejection[1],
          }),
        })
        return NextResponse.json({ attempted: 1, status: 'QUEUED', stage: 'FINALIZE' })
      }
      const outcome =
        sis?.decision === 'WEAK_SIGNAL' || sis?.decision === 'ARCHIVE' ? 'WEAK_SIGNAL' : 'SIGNAL'
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
      await complete(db, providerClaim, {
        p_validated_output: enriched,
        p_finalization_outcome: outcome,
        p_finalization_signal: signal,
        p_finalization_decision: decisionPayload(sis),
      })
      return NextResponse.json({ attempted: 1, status: 'QUEUED', stage: 'FINALIZE', outcome })
    } catch (error) {
      if (error instanceof DurableCommitError) {
        return NextResponse.json({ attempted: 1, status: 'COMMIT_RETRY' }, { status: 503 })
      }
      const diagnostic = safeDiagnostic(error, ref)
      assertSafeDiagnostic(diagnostic)
      const chain = getModelChain(providerClaim.stage === 'CLASSIFIER' ? 'classifier' : 'parser')
      const fallback = nextRunnableModel(chain, ref, messages, outputBudget)
      if (!fallback) {
        await failStage(db, providerClaim, { status: 'TERMINAL', diagnostic })
        return NextResponse.json({
          attempted: 1,
          status: 'FAILED',
          stage: providerClaim.stage,
          diagnostic: diagnostic.type,
        })
      }
      const fallbackReservation = budgetReservationFor(messages, fallback, outputBudget)
      const completed = await complete(db, providerClaim, {
        p_status: 'RETRYABLE',
        p_safe_diagnostic: diagnostic,
        p_next_stage: providerClaim.stage,
        p_next_provider: fallback.provider,
        p_next_model: fallback.model,
        p_next_units: fallbackReservation.units,
        p_next_unit_kind: fallbackReservation.unitKind,
      })
      return NextResponse.json({
        attempted: 1,
        status: completed.status === 'FAILED' ? 'FAILED' : 'QUEUED',
        stage: completed.stage ?? providerClaim.stage,
        diagnostic: completed.reason ?? diagnostic.type,
      })
    }
  } catch (error) {
    if (error instanceof DurableCommitError) {
      return NextResponse.json({ attempted: 0, status: 'COMMIT_RETRY' }, { status: 503 })
    }
    throw error
  } finally {
    await releaseEnrichmentLock(db, holder)
  }
}
