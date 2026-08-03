/**
 * AIscentra — Signal Engine V2
 *
 * Architecture per Signal Engine V2 specification and 61-file project documentation.
 *
 * Pipeline:
 *   Observation
 *   ↓ Stage 1: Hard Rejection (R-01 to R-12, zero cost)
 *   ↓ Stage 2: Knowledge Graph Ingestion (entity extraction to graph)
 *   ↓ Stage 3: Strategic Importance Score (cheap LLM call ~400 tokens)
 *   ↓ Stage 4: AI Enrichment (full analytical description)
 *   ↓ Stage 5: Validation + Scoring (server-side computation)
 *   ↓ Stage 6: Publish Signal or route to Weak Signal + write Decision Log
 *   Signal | Weak Signal | Archived Observation
 *
 * Every decision is logged in signal_decision_log.
 * Every Signal carries engine_version for retrospective analysis.
 */
import { agentCompleteJSON } from '@/lib/ai/agent'
import { AIProviderError } from '@/lib/ai/client'
import { AIDeadlineExceededError } from '@/lib/ai/deadline'
import { createAdminClient } from '@/lib/supabase/server'
import {
  EnrichmentOutputSchema,
  ENRICHMENT_SYSTEM_PROMPT,
  buildEnrichmentPrompt,
} from './enrichment-prompt'
import { SISOutputSchema, SIS_SYSTEM_PROMPT, buildSISPrompt, computeSIS } from './strategic-score'
import { checkHardRejection, V2_THRESHOLDS } from './pre-qualification'
import { computeAllScores, computeMomentumScore, validateFactors } from './scoring'
import { validateSignal } from './validation'
import { checkDuplicate, getRecentSignalTitles } from './deduplication'
import type { ObservationRow } from '@/modules/observations/queries'
import type { SignalCategory } from '@/types/database'

// ── Engine version ────────────────────────────────────────────────────────────

const ENGINE_VERSION = 'v2.0'

// ── Input token budget ───────────────────────────────────────────────────────
// Defensive truncation applied to observation.content before it reaches
// either prompt builder (SIS and enrichment). Both buildSISPrompt and
// buildEnrichmentPrompt already slice their own local copy (400 / 300
// chars respectively) for the CONTENT portion of their prompt, but this
// guard caps the raw content at the source, once, so an unusually large
// observation.content value can never surprise either call site or a
// future prompt builder that forgets to slice on its own.
// Approximation: ~4 characters per token for English text (no tokenizer
// dependency added, per project dependency-discipline rules) -- 500
// tokens ≈ 2000 characters.
const MAX_INPUT_TOKENS = 500
const CHARS_PER_TOKEN_ESTIMATE = 4
const MAX_INPUT_CHARS = MAX_INPUT_TOKENS * CHARS_PER_TOKEN_ESTIMATE

function truncateForTokenBudget(content: string): string {
  return content.length > MAX_INPUT_CHARS ? content.slice(0, MAX_INPUT_CHARS) : content
}

// ── Category Pre-Assignment (V1 compatible) ───────────────────────────────────

// ── Result type ───────────────────────────────────────────────────────────────

export interface SignalEngineResult {
  observationId: string
  outcome:
    | 'signal_created'
    | 'weak_signal_created'
    | 'rejected_duplicate'
    | 'rejected_marketing'
    | 'rejected_hard_rule'
    | 'rejected_low_sis'
    | 'rejected_validation'
    | 'rejected_low_score'
    | 'archived_observation'
    | 'error'
  signalId?: string | undefined
  reason?: string | undefined
  scores?: { signal_score: number; confidence_score: number; momentum_score: number } | undefined
  sis_final?: number | undefined
}

// ── Decision Log writer ───────────────────────────────────────────────────────

async function writeDecisionLog(params: {
  supabase: ReturnType<typeof createAdminClient>
  signal_id: string | null
  observation_id: string
  decision: string
  rejection_code?: string | null | undefined
  rejection_reason?: string | null | undefined
  engine_justification: string
  qualification_score?: number | null
  sis_novelty?: number | null
  sis_importance?: number | null
  sis_urgency?: number | null
  sis_confidence?: number | null
  sis_final?: number | null
  human_relevance_breakdown?: Record<string, unknown>
  anti_hype_score?: number | null
  rule_trace?: string[]
}): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (params.supabase as any).from('signal_decision_log').insert({
      signal_id: params.signal_id,
      observation_id: params.observation_id,
      decision: params.decision,
      rejection_code: params.rejection_code ?? null,
      rejection_reason: params.rejection_reason ?? null,
      engine_justification: params.engine_justification,
      qualification_score: params.qualification_score ?? null,
      sis_novelty: params.sis_novelty ?? null,
      sis_importance: params.sis_importance ?? null,
      sis_urgency: params.sis_urgency ?? null,
      sis_confidence: params.sis_confidence ?? null,
      sis_final: params.sis_final ?? null,
      human_relevance_breakdown: params.human_relevance_breakdown ?? {},
      anti_hype_score: params.anti_hype_score ?? null,
      rule_trace: params.rule_trace ?? [],
      thresholds_snapshot: V2_THRESHOLDS,
      engine_version: ENGINE_VERSION,
    })
  } catch (err) {
    console.error('[engine] decision_log write failed:', err)
    // Non-blocking — never fail Signal creation due to log write failure
  }
}

// ── Knowledge Graph ingestion ─────────────────────────────────────────────────

async function ingestToKnowledgeGraph(
  supabase: ReturnType<typeof createAdminClient>,
  observationId: string,
  title: string,
  category: string,
): Promise<string | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any)
      .from('knowledge_graph_nodes')
      .upsert(
        {
          node_type: 'observation',
          node_id: observationId,
          label: title.slice(0, 200),
          properties: { category },
          engine_version: ENGINE_VERSION,
        },
        { onConflict: 'node_id', ignoreDuplicates: false },
      )
      .select('id')
      .single()
    return (data as { id: string } | null)?.id ?? null
  } catch {
    return null
  }
}

// ── Source authority override ─────────────────────────────────────────────────

const SOURCE_AUTHORITY: Record<string, number> = {
  company_blog: 10,
  research: 7,
  technical: 6,
  news: 5,
  community: 3,
}

// ── Main Engine Function ──────────────────────────────────────────────────────

export async function processObservation(
  observation: ObservationRow,
  sourceTrustScore: number,
  sourceName: string,
  sourceType: string = '',
  deadlineAt: number,
): Promise<SignalEngineResult> {
  const supabase = createAdminClient()

  // ── Stage 1: Hard Rejection ──────────────────────────────────────────────
  const hardRejection = checkHardRejection(observation, sourceType)
  if (hardRejection.rejected) {
    // Update observation with rejection
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any)
      .from('observations')
      .update({
        qualification_result: 'DISCARD',
        rejection_code: hardRejection.code,
        rejection_reason: hardRejection.reason,
        engine_version: ENGINE_VERSION,
      })
      .eq('id', observation.id)

    await writeDecisionLog({
      supabase,
      signal_id: null,
      observation_id: observation.id,
      decision: 'DISCARD',
      rejection_code: hardRejection.code,
      rejection_reason: hardRejection.reason,
      engine_justification: `Hard rejection rule ${hardRejection.code} matched: ${hardRejection.reason}`,
    })

    return {
      observationId: observation.id,
      outcome: 'rejected_hard_rule',
      reason: `${hardRejection.code}: ${hardRejection.reason}`,
    }
  }

  function preAssignCategory(title: string, content: string): string {
    const CATS = [
      { cat: 'REGULATION', kw: ['regulation', 'policy', 'law', 'compliance', 'government'] },
      { cat: 'FUNDING', kw: ['funding', 'raises', 'series', 'investment', 'venture'] },
      { cat: 'MODELS', kw: ['model', 'llm', 'gpt', 'claude', 'gemini', 'llama', 'weights'] },
      { cat: 'AGENTS', kw: ['agent', 'autonomous', 'agentic', 'multi-agent'] },
      { cat: 'INFRASTRUCTURE', kw: ['api', 'cloud', 'infrastructure', 'compute', 'platform'] },
      { cat: 'HARDWARE', kw: ['chip', 'gpu', 'tpu', 'nvidia', 'semiconductor'] },
      {
        cat: 'OPEN_SOURCE',
        kw: ['open source', 'open-source', 'weights released', 'apache', 'mit license'],
      },
      { cat: 'COMPANIES', kw: ['acqui', 'partnership', 'ceo', 'strategy', 'launch', 'announces'] },
    ]
    const text = (title + ' ' + content.slice(0, 500)).toLowerCase()
    for (const { cat, kw } of CATS) {
      if (kw.some((k) => text.includes(k))) return cat
    }
    return 'RESEARCH'
  }

  // ── Stage 2: Category + Deduplication ────────────────────────────────────
  const candidateCategory = preAssignCategory(
    observation.title,
    observation.content,
  ) as SignalCategory

  const dupCheck = await checkDuplicate(observation.title, candidateCategory)
  if (dupCheck.isDuplicate) {
    await writeDecisionLog({
      supabase,
      signal_id: null,
      observation_id: observation.id,
      decision: 'DISCARD',
      rejection_code: 'R-11',
      rejection_reason: dupCheck.reason,
      engine_justification: `Duplicate detected before enrichment: ${dupCheck.reason}`,
    })
    return {
      observationId: observation.id,
      outcome: 'rejected_duplicate',
      reason: dupCheck.reason,
    }
  }

  // ── Stage 2b: Knowledge Graph Ingestion ──────────────────────────────────
  // Observation becomes a graph entity before Signal generation
  await ingestToKnowledgeGraph(supabase, observation.id, observation.title, candidateCategory)

  // ── Stage 3: Strategic Importance Score ──────────────────────────────────
  // Cheap LLM call (~400 tokens) — determines if enrichment is worth running
  let sisResult: ReturnType<typeof computeSIS> | null = null

  try {
    const sisRaw = await agentCompleteJSON(
      'classifier',
      [
        { role: 'system', content: SIS_SYSTEM_PROMPT },
        {
          role: 'user',
          content: buildSISPrompt(
            observation.title,
            truncateForTokenBudget(observation.content),
            sourceName,
            sourceType,
          ),
        },
      ],
      SISOutputSchema,
      { temperature: 0, maxTokens: 400 },
      deadlineAt,
    )
    sisResult = computeSIS(
      sisRaw as Parameters<typeof computeSIS>[0],
      observation.title,
      observation.content,
    )
  } catch (err) {
    // Re-throw rate limit — batch handler will retry
    if (err instanceof AIProviderError && err.statusCode === 429) throw err
    // Re-throw deadline exceeded — batch handler must requeue this
    // observation and stop the batch, never silently proceed as if SIS
    // just wasn't available (the whole point of the shared deadline is
    // that continuing further work is not safe here).
    if (err instanceof AIDeadlineExceededError) throw err
    // SIS failure → proceed without SIS (V1 fallback)
    console.warn('[engine] SIS evaluation failed, proceeding without:', err)
  }

  // Apply SIS decision if available
  if (sisResult && sisResult.decision === 'DISCARD') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any)
      .from('observations')
      .update({
        qualification_result: 'DISCARD',
        rejection_code: 'R-09',
        rejection_reason: `Low SIS: final=${sisResult.sis.final.toFixed(2)}, roles=${sisResult.human_relevance.roles_yes_count}`,
        qualification_score: sisResult.sis.final,
        engine_version: ENGINE_VERSION,
      })
      .eq('id', observation.id)

    await writeDecisionLog({
      supabase,
      signal_id: null,
      observation_id: observation.id,
      decision: 'DISCARD',
      rejection_code: 'R-09',
      rejection_reason: `SIS_FINAL=${sisResult.sis.final.toFixed(2)} below threshold ${V2_THRESHOLDS.SIS_WEAK_MIN}`,
      engine_justification: sisResult.engine_justification,
      sis_novelty: sisResult.sis.novelty,
      sis_importance: sisResult.sis.importance,
      sis_urgency: sisResult.sis.urgency,
      sis_confidence: sisResult.sis.confidence,
      sis_final: sisResult.sis.final,
      human_relevance_breakdown: sisResult.human_relevance as unknown as Record<string, unknown>,
      anti_hype_score: sisResult.anti_hype_score,
      rule_trace: sisResult.rule_trace,
    })

    return {
      observationId: observation.id,
      outcome: 'rejected_low_sis',
      reason: `SIS_FINAL=${sisResult.sis.final.toFixed(2)} — insufficient strategic importance`,
      sis_final: sisResult.sis.final,
    }
  }

  // ── Stage 4: Full AI Enrichment ───────────────────────────────────────────
  const recentTitles = await getRecentSignalTitles(candidateCategory, 10)
  const prompt = buildEnrichmentPrompt({
    title: observation.title,
    content: truncateForTokenBudget(observation.content),
    sourceUrl: (observation.metadata['feed_url'] as string | undefined) ?? '',
    sourceName,
    sourceTrustScore,
    candidateCategory,
    recentSignalTitles: recentTitles,
  })

  let enriched
  try {
    enriched = await agentCompleteJSON(
      'parser',
      [
        { role: 'system', content: ENRICHMENT_SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      EnrichmentOutputSchema,
      { temperature: 0.2, maxTokens: 1024 },
      deadlineAt,
    )
  } catch (err) {
    if (err instanceof AIProviderError && err.statusCode === 429) throw err
    // Re-throw deadline exceeded — must never be recorded as a
    // permanent processing_error (see the identical comment on the SIS
    // call site above for the full rationale).
    if (err instanceof AIDeadlineExceededError) throw err
    const message = err instanceof Error ? err.message : 'Enrichment failed'
    return { observationId: observation.id, outcome: 'error', reason: message }
  }

  // Reject marketing
  if (enriched.is_marketing) {
    return {
      observationId: observation.id,
      outcome: 'rejected_marketing',
      reason: 'marketing_content_detected',
    }
  }

  // Reject duplicate flagged by agent
  if (enriched.is_duplicate) {
    return {
      observationId: observation.id,
      outcome: 'rejected_duplicate',
      reason: `duplicate_flagged_by_agent: ${enriched.duplicate_note ?? ''}`,
    }
  }

  // ── Stage 5: Score computation ────────────────────────────────────────────
  const toInt = (v: unknown): number => {
    const n = typeof v === 'string' ? parseFloat(v) : Number(v)
    return isNaN(n) ? 0 : Math.min(10, Math.max(0, Math.round(n)))
  }

  const factors = {
    impact_factor: toInt(enriched.impact_factor),
    actor_factor: toInt(enriched.actor_factor),
    novelty_factor: toInt(enriched.novelty_factor),
    verifiability_factor: toInt(enriched.verifiability_factor),
    strategic_factor: toInt(enriched.strategic_factor),
    authority_factor: toInt(enriched.authority_factor),
    corroboration_factor: toInt(enriched.corroboration_factor),
    specificity_factor: toInt(enriched.specificity_factor),
    category_confidence_factor: toInt(enriched.category_confidence_factor),
    consistency_factor: 7,
  }

  // Override authority_factor from source type
  const authOver = SOURCE_AUTHORITY[sourceType.toLowerCase()]
  if (authOver !== undefined) factors.authority_factor = authOver

  const factorErrors = validateFactors(factors)
  if (factorErrors.length > 0) {
    return {
      observationId: observation.id,
      outcome: 'error',
      reason: `Factor validation: ${factorErrors.join(', ')}`,
    }
  }

  const { signal_score, confidence_score } = computeAllScores(factors)
  const momentum_score = computeMomentumScore({
    newObservationsCount: 1,
    distinctSourceCount: 1,
    crossCategoryRefCount: 0,
    daysSinceCreation: 0,
  })

  const validation = validateSignal({
    title: enriched.title,
    description: enriched.description,
    signal_score,
    confidence_score,
    category: enriched.category,
    observation_ids: [observation.id],
    entities: (enriched.entities ?? []).map((e) => ({
      name: e.name,
      type: (e.type as string) ?? 'TECHNOLOGY',
    })),
  })

  if (!validation.valid) {
    const outcome = validation.canRetry ? 'rejected_validation' : 'rejected_low_score'
    return { observationId: observation.id, outcome, reason: validation.rejectionReason }
  }

  // ── Stage 6: Determine Signal vs Weak Signal ──────────────────────────────
  // Weak Signal: SIS between 4.0-5.9, or SIS unavailable but score < 55
  const isWeakSignal = sisResult ? sisResult.decision === 'WEAK_SIGNAL' : signal_score < 55

  const signalStatus = isWeakSignal ? 'WEAK' : 'ACTIVE'
  const intelligenceType = isWeakSignal ? 'WEAK_SIGNAL' : 'SIGNAL'

  // ── Entity resolution + upsert ────────────────────────────────────────────
  const entityIds: string[] = []
  for (const entity of enriched.entities ?? []) {
    const canonicalName = entity.name
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: entityRecord } = await (supabase as any)
      .from('entities')
      .upsert(
        { name: entity.name, canonical_name: canonicalName, entity_type: entity.type },
        { onConflict: 'canonical_name', ignoreDuplicates: false },
      )
      .select('id')
      .single()
    if (entityRecord?.id) entityIds.push(entityRecord.id as string)
  }

  // ── Create Signal ─────────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: signal, error: signalError } = await (supabase as any)
    .from('signals')
    .insert({
      title: enriched.title,
      description: enriched.description,
      category: enriched.category,
      status: signalStatus,

      // V1 factors
      ...factors,
      signal_score,
      confidence_score,
      momentum_score,

      // V2: intelligence classification
      intelligence_type: intelligenceType,

      // V2: SIS dimensions
      sis_novelty: sisResult?.sis.novelty ?? null,
      sis_importance: sisResult?.sis.importance ?? null,
      sis_urgency: sisResult?.sis.urgency ?? null,
      sis_confidence: sisResult?.sis.confidence ?? null,
      sis_final: sisResult?.sis.final ?? null,

      // V2: Human relevance
      human_relevance_flags: sisResult?.human_relevance ?? {},

      // V2: Anti-hype
      anti_hype_score: sisResult?.anti_hype_score ?? null,
      anti_hype_flags: { flags: sisResult?.anti_hype_flags ?? [] },

      // V2: Future relevance
      relevance_horizon: sisResult?.relevance_horizon ?? null,

      // V2: Lifecycle
      lifecycle_state: 'ACTIVE',
      engine_version: ENGINE_VERSION,

      // V1: Lifecycle
      validation_flags: validation.flags,
      manual_override: false,
      observation_ids: [observation.id],
      entity_ids: entityIds,
      momentum_last_calculated: new Date().toISOString(),

      metadata: {
        enriched_at: new Date().toISOString(),
        novelty_prior_example: enriched.novelty_prior_example ?? null,
        engine_version: ENGINE_VERSION,
        momentum_calculation: {
          new_observations_count: 1,
          distinct_source_count: 1,
          cross_category_ref_count: 0,
        },
        audit_log: [],
      },
    })
    .select('id')
    .single()

  if (signalError || !signal?.id) {
    return {
      observationId: observation.id,
      outcome: 'error',
      reason: `Signal insert failed: ${signalError?.message ?? 'unknown'}`,
    }
  }

  const signalId = signal.id as string

  // ── Write Decision Log ────────────────────────────────────────────────────
  await writeDecisionLog({
    supabase,
    signal_id: signalId,
    observation_id: observation.id,
    decision: isWeakSignal ? 'WEAK_SIGNAL' : 'SIGNAL',
    engine_justification:
      sisResult?.engine_justification ??
      `Signal created via V1 scoring. signal_score=${signal_score}, confidence=${confidence_score}. SIS evaluation unavailable.`,
    sis_novelty: sisResult?.sis.novelty ?? null,
    sis_importance: sisResult?.sis.importance ?? null,
    sis_urgency: sisResult?.sis.urgency ?? null,
    sis_confidence: sisResult?.sis.confidence ?? null,
    sis_final: sisResult?.sis.final ?? null,
    human_relevance_breakdown: sisResult?.human_relevance as unknown as Record<string, unknown>,
    anti_hype_score: sisResult?.anti_hype_score ?? null,
    rule_trace: sisResult?.rule_trace ?? [],
  })

  // ── Update observation ────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any)
    .from('observations')
    .update({
      qualification_result: isWeakSignal ? 'WEAK_SIGNAL' : 'SIGNAL',
      qualification_score: sisResult?.sis.final ?? signal_score,
      engine_version: ENGINE_VERSION,
    })
    .eq('id', observation.id)

  return {
    observationId: observation.id,
    outcome: isWeakSignal ? 'weak_signal_created' : 'signal_created',
    signalId,
    scores: { signal_score, confidence_score, momentum_score },
    sis_final: sisResult?.sis.final ?? undefined,
  }
}
