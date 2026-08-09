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
import { AITokenBudgetExceededError } from '@/lib/ai/budget-gate'
import { createAdminClient } from '@/lib/supabase/server'
import {
  EnrichmentOutputSchema,
  ENRICHMENT_SYSTEM_PROMPT,
  buildEnrichmentPrompt,
} from './enrichment-prompt'
import { SISOutputSchema, SIS_SYSTEM_PROMPT, buildSISPrompt, computeSIS } from './strategic-score'
import {
  checkHardRejection,
  checkPreFilter,
  PRE_FILTER_MIN,
  V2_THRESHOLDS,
} from './pre-qualification'
import { computeAllScores, computeMomentumScore, validateFactors } from './scoring'
import { validateSignal } from './validation'
import { checkDuplicate, checkCorroboration, getRecentSignalTitles } from './deduplication'
import type { ObservationRow } from '@/modules/observations/queries'
import type { SignalCategory, QualificationResult } from '@/types/database'

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

// ── Weak-signal classification ──────────────────────────────────────────────
//
// Extracted as its own pure, exported function specifically so the real
// bug this fixes is directly unit-testable without needing a full
// processObservation() integration test: classifyBySIS() (src/types/
// database.ts) returns FOUR possible values -- 'SIGNAL' | 'WEAK_SIGNAL' |
// 'ARCHIVE' | 'DISCARD' -- but the inline check this replaced tested
// ONLY `=== 'WEAK_SIGNAL'`. A SIS score of 2.0-3.99 classifies as
// 'ARCHIVE', which is neither 'WEAK_SIGNAL' nor 'DISCARD' (DISCARD is
// handled earlier in the pipeline and never reaches this decision), so
// the old check evaluated to `false` and the signal became fully
// ACTIVE. Confirmed against production: ACTIVE signals existed with SIS
// 2.20-3.90, squarely inside the previously-unchecked ARCHIVE band --
// the exact opposite of Constitution Article 3.3's "scarcity
// philosophy" (prefer no Signal over a wrong one).
//
// Both 'WEAK_SIGNAL' and 'ARCHIVE' now map to non-ACTIVE. An
// ARCHIVE-tier SIS score is weaker evidence than WEAK_SIGNAL-tier, so it
// must never be treated as MORE trustworthy by falling through
// unchecked to ACTIVE.
export function isWeakSignalDecision(
  sisDecision: QualificationResult | undefined,
  signalScore: number,
): boolean {
  if (sisDecision === undefined) {
    // SIS was unavailable for this observation (see engine's own
    // "SIS failure -> proceed without SIS" fallback) -- fall back to the
    // V1 signal_score threshold, unchanged from the pre-existing
    // behavior for this specific case.
    return signalScore < 55
  }
  return sisDecision === 'WEAK_SIGNAL' || sisDecision === 'ARCHIVE'
}

export interface SignalEngineResult {
  observationId: string
  outcome:
    | 'signal_created'
    | 'weak_signal_created'
    | 'corroborated_existing_signal'
    | 'archived_prefilter'
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

  // ── Stage 1b: Deterministic pre-filter (zero AI cost) ─────────────────────
  // Real, measured problem this closes: at ~2,527 tokens per real
  // enrichment (70b) call against Groq's real 100,000 TPD limit, Signal
  // Engine can process at most ~39.6 observations/day via the full
  // AI path -- against real intake of ~400/day, ~10x too much for
  // full AI treatment. checkPreFilter (pre-qualification.ts) provides
  // a free, keyword-based signal-worthiness score; anything below
  // PRE_FILTER_MIN is archived WITHOUT spending any AI budget, but the
  // observation ROW ITSELF is preserved (never deleted) -- it can
  // still be found, audited, or reprocessed later (e.g. if the filter
  // is tuned), it simply does not reach SIS/enrichment now.
  const preFilter = checkPreFilter(observation)
  if (!preFilter.passed) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any)
      .from('observations')
      .update({
        qualification_result: 'ARCHIVE',
        rejection_code: 'R-13',
        rejection_reason: `Deterministic pre-filter score ${preFilter.score.toFixed(1)} below minimum ${PRE_FILTER_MIN}`,
        qualification_score: preFilter.score,
        engine_version: ENGINE_VERSION,
      })
      .eq('id', observation.id)

    await writeDecisionLog({
      supabase,
      signal_id: null,
      observation_id: observation.id,
      decision: 'ARCHIVE',
      rejection_code: 'R-13',
      rejection_reason: `Deterministic pre-filter score ${preFilter.score.toFixed(1)} below minimum ${PRE_FILTER_MIN}`,
      engine_justification: `Zero-AI-cost keyword score ${preFilter.score.toFixed(1)}/10 did not meet the ${PRE_FILTER_MIN} threshold required to spend AI budget on SIS/enrichment. Observation preserved, not deleted.`,
      qualification_score: preFilter.score,
    })

    return {
      observationId: observation.id,
      outcome: 'archived_prefilter',
      reason: `R-13: deterministic pre-filter score ${preFilter.score.toFixed(1)} < ${PRE_FILTER_MIN}`,
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

  const dupCheck = await checkDuplicate(observation.title, candidateCategory, observation.source_id)
  if (dupCheck.isDuplicate) {
    // REAL GAP FOUND AND FIXED: every OTHER rejection path in this
    // function (hard rejection, pre-filter, SIS-level discard) updates
    // the observation row itself with a matching qualification_result/
    // rejection_code -- this was the one path that wrote a
    // signal_decision_log entry explaining WHY (R-11, duplicate) but
    // left the observation's own qualification_result/rejection_code
    // unset, so an auditor reading only the observations table (not
    // joining to signal_decision_log) could not see why this specific
    // row was rejected.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any)
      .from('observations')
      .update({
        qualification_result: 'DISCARD',
        rejection_code: 'R-11',
        rejection_reason: dupCheck.reason,
        engine_version: ENGINE_VERSION,
      })
      .eq('id', observation.id)

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

  // ── Stage 2a2: Corroboration Check (source diversification) ──────────────
  // Runs BEFORE the expensive SIS/enrichment AI stages deliberately: if
  // this observation corroborates an existing signal, there is no need
  // to spend AI budget writing a brand-new description for what is, in
  // substance, the same event -- the existing signal is strengthened
  // instead. See checkCorroboration's own docstring in deduplication.ts
  // for the full rationale and the real gap this closes (every signal
  // was single-sourced by construction until this fix).
  const corrCheck = await checkCorroboration(
    observation.title,
    candidateCategory,
    observation.source_id,
  )
  if (corrCheck.isCorroboration && corrCheck.matchedSignalId && corrCheck.matchedObservationIds) {
    const updatedObservationIds = [...corrCheck.matchedObservationIds, observation.id]

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: matchedSignal } = await (supabase as any)
      .from('signals')
      .select('confidence_score')
      .eq('id', corrCheck.matchedSignalId)
      .single()

    // Modest, explicit bump for one additional independent confirmation
    // -- matches SIGNAL_LIFECYCLE.md's "Strengthened" stage ("independent
    // confirmation... Importance Score increases"), capped at 100.
    // Recomputed momentum now reflects the REAL distinct source count
    // (>=2) instead of the hardcoded 1 every prior signal was created
    // with -- this is the only place in the codebase where
    // distinctSourceCount is genuinely >1.
    const priorConfidence = (matchedSignal?.confidence_score as number | undefined) ?? 60
    const newConfidence = Math.min(100, priorConfidence + 5)
    const newMomentum = computeMomentumScore({
      newObservationsCount: 1,
      distinctSourceCount: updatedObservationIds.length,
      crossCategoryRefCount: 0,
      daysSinceCreation: 0,
    })

    // REAL BUG FIXED: this used to be three separate, unchecked `await`
    // writes (signal update, observation update, decision log insert) --
    // none checked for an `error` in the response, so a failure on any
    // ONE of them still let execution continue to the next write and
    // still returned outcome:'corroborated_existing_signal', a
    // partially-applied merge with a decision log claiming success.
    //
    // Now a single atomic RPC (apply_signal_corroboration, see
    // supabase/migrations/20260809100000_atomic_signal_corroboration.sql)
    // performs all three writes inside ONE PostgreSQL transaction --
    // if the RPC throws, NONE of the three writes are committed, full
    // stop, verified directly by a real-PostgreSQL atomicity test.
    //
    // FAIL-CLOSED, not fail-lost: on failure, this observation is NOT
    // marked as corroborated and NO decision log entry claims it was --
    // but it is also not silently dropped. Falling through to the
    // normal pipeline below (rather than returning an error outcome
    // here) means the observation proceeds through SIS/enrichment and,
    // worst case, becomes its own standalone signal -- exactly the
    // behavior that existed before corroboration was implemented at
    // all, which is the safe, conservative degradation.
    const justification = `Corroborates existing signal "${corrCheck.matchedTitle}" (similarity=${((corrCheck.similarityScore ?? 0) * 100).toFixed(1)}%, independent source) -- merged as additional evidence rather than creating a duplicate single-source signal.`

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: applied, error: rpcError } = await (supabase as any).rpc(
        'apply_signal_corroboration',
        {
          p_signal_id: corrCheck.matchedSignalId,
          p_new_observation_id: observation.id,
          p_updated_observation_ids: updatedObservationIds,
          p_new_confidence_score: newConfidence,
          p_new_momentum_score: newMomentum,
          p_engine_version: ENGINE_VERSION,
          p_engine_justification: justification,
        },
      )

      if (rpcError || applied !== true) {
        console.error(
          '[engine] apply_signal_corroboration failed -- falling through to normal pipeline (fail-closed, not fail-lost):',
          rpcError?.message ?? 'RPC returned falsy',
        )
      } else {
        return {
          observationId: observation.id,
          outcome: 'corroborated_existing_signal',
          signalId: corrCheck.matchedSignalId,
          reason: `Corroborates "${corrCheck.matchedTitle}" from an independent source`,
        }
      }
    } catch (err) {
      console.error(
        '[engine] apply_signal_corroboration threw -- falling through to normal pipeline (fail-closed, not fail-lost):',
        err instanceof Error ? err.message : String(err),
      )
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
    // Re-throw budget exhaustion — identical rationale to the deadline
    // case above, and previously missing here entirely: SIS would
    // silently swallow this exact error (it is neither AIProviderError
    // nor AIDeadlineExceededError) and fall through to "proceed without
    // SIS", masking a real, temporary budget refusal as if the
    // classifier had simply been skipped. The batch handler must see
    // this to requeue the observation and stop the cycle instead.
    if (err instanceof AITokenBudgetExceededError) throw err
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
      // REAL BUG FIXED: this call previously omitted qualification_score
      // while the observation UPDATE immediately above correctly set it
      // to sisResult.sis.final -- signal_decision_log silently got NULL
      // for a value that had a genuine, computed number just lines away.
      qualification_score: sisResult.sis.final,
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
    // Re-throw budget exhaustion — must never become a permanent
    // processing_error via the generic `return { outcome: 'error' }`
    // below. Previously fell through exactly there: the batch handler
    // would call markObservationProcessed with the budget-refusal
    // message and the observation would never be retried, even though
    // the refusal is temporary and resolves once budget frees up.
    if (err instanceof AITokenBudgetExceededError) throw err
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
  // REAL BUG FIXED HERE: classifyBySIS() (src/types/database.ts) returns
  // FOUR possible values -- 'SIGNAL' | 'WEAK_SIGNAL' | 'ARCHIVE' | 'DISCARD'
  // -- but this check previously tested ONLY `=== 'WEAK_SIGNAL'`. A SIS
  // score of 2.0-3.99 classifies as 'ARCHIVE', which is neither
  // 'WEAK_SIGNAL' nor 'DISCARD' (DISCARD is already handled earlier and
  // never reaches this line), so `isWeakSignal` evaluated to `false` and
  // the signal became fully ACTIVE -- confirmed against production:
  // ACTIVE signals existed with SIS 2.20-3.90, squarely inside the
  // unchecked ARCHIVE band. This is the exact opposite of Constitution
  // Article 3.3's "scarcity philosophy" (prefer no Signal over a wrong
  // one) -- a signal scoring below even the WEAK_SIGNAL floor was being
  // published with full ACTIVE status, indistinguishable from a strong
  // signal to any reader or to the Assistant/Forecast systems that treat
  // ACTIVE signals as reliable evidence.
  //
  // Fixed to treat BOTH 'WEAK_SIGNAL' and 'ARCHIVE' as non-ACTIVE: an
  // ARCHIVE-tier SIS score is weaker evidence than WEAK_SIGNAL-tier, so it
  // must never be treated as MORE trustworthy by falling through
  // unchecked. Mapped to the same 'WEAK' status/'WEAK_SIGNAL' intelligence
  // type as an explicit WEAK_SIGNAL decision, rather than inventing a new
  // status this session -- ARCHIVE-tier material is kept (matching the
  // Constitution's "no silent deletion" stance) but never surfaces as a
  // full-strength Signal.
  const isWeakSignal = isWeakSignalDecision(sisResult?.decision, signal_score)

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
      // REAL BUG FIXED: qualification_score was never included in this
      // INSERT at all (only sis_final, a different column, was set) --
      // every signal's qualification_score defaulted to NULL at the
      // database level, confirmed against production: all 17 signals
      // created in the prior 24h had qualification_score=NULL. Uses the
      // same fallback chain already used for the OBSERVATION row's own
      // qualification_score a few lines below in this function, so the
      // signal and its source observation agree on this value.
      qualification_score: sisResult?.sis.final ?? signal_score,

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
  // REAL BUG FIXED: this call previously omitted qualification_score
  // entirely, even though writeDecisionLog itself accepts and writes
  // it. The signal INSERT above and the observation UPDATE below both
  // correctly set qualification_score to the same value
  // (sisResult?.sis.final ?? signal_score) -- but signal_decision_log
  // silently got NULL for every normal signal creation, a genuine
  // three-way inconsistency between signal/observation/decision_log
  // for the exact same qualifying event.
  await writeDecisionLog({
    supabase,
    signal_id: signalId,
    observation_id: observation.id,
    decision: isWeakSignal ? 'WEAK_SIGNAL' : 'SIGNAL',
    engine_justification:
      sisResult?.engine_justification ??
      `Signal created via V1 scoring. signal_score=${signal_score}, confidence=${confidence_score}. SIS evaluation unavailable.`,
    qualification_score: sisResult?.sis.final ?? signal_score,
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
