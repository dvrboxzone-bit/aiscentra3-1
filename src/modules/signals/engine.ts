/**
 * AIscentra — Signal Engine
 *
 * Transforms a single observation into a Signal.
 * Implements the full pipeline from Signal Scoring Specification v1.0:
 *
 * Observation → [Pre-qualify] → [Deduplicate] → [Enrich] → [Score] → [Validate] → Signal
 *
 * Called per observation to stay within Vercel's 10s function timeout.
 */
import { agentCompleteJSON } from '@/lib/ai/agent'
import { createAdminClient } from '@/lib/supabase/server'
import { serverEnv } from '@/config/env'
import {
  EnrichmentOutputSchema,
  ENRICHMENT_SYSTEM_PROMPT,
  buildEnrichmentPrompt,
} from './enrichment-prompt'
import { computeAllScores, computeMomentumScore, validateFactors } from './scoring'
import { validateSignal } from './validation'
import { checkDuplicate, getRecentSignalTitles } from './deduplication'
import type { ObservationRow } from '@/modules/observations/queries'
import type { SignalCategory } from '@/types/database'

// ── Category Pre-Assignment ───────────────────────────────────────────────────
// Quick keyword-based category guess before enrichment
// Mirrors the priority order from Signal Scoring Spec v1.0, Section 04.2

const CATEGORY_SIGNALS: { category: SignalCategory; keywords: string[] }[] = [
  { category: 'REGULATION',     keywords: ['regulation', 'policy', 'legislation', 'law', 'compliance', 'eu ai act', 'nist', 'government', 'legal', 'enforcement'] },
  { category: 'FUNDING',        keywords: ['funding', 'raises', 'series', 'investment', 'valuation', 'billion', 'million', 'venture', 'investor', 'round'] },
  { category: 'MODELS',         keywords: ['model', 'llm', 'gpt', 'claude', 'gemini', 'mistral', 'llama', 'weights', 'benchmark', 'fine-tune', 'release'] },
  { category: 'RESEARCH',       keywords: ['paper', 'arxiv', 'research', 'findings', 'study', 'experiment', 'dataset', 'evaluation', 'breakthrough'] },
  { category: 'AGENTS',         keywords: ['agent', 'autonomous', 'agentic', 'multi-agent', 'workflow automation', 'tool use'] },
  { category: 'COMPANIES',      keywords: ['acqui', 'partnership', 'ceo', 'leadership', 'strategy', 'pivot', 'expansion', 'launch', 'announces'] },
  { category: 'INFRASTRUCTURE', keywords: ['api', 'cloud', 'deployment', 'infrastructure', 'compute', 'platform', 'service', 'endpoint', 'latency'] },
  { category: 'HARDWARE',       keywords: ['chip', 'gpu', 'tpu', 'accelerator', 'nvidia', 'amd', 'intel', 'semiconductor', 'hardware'] },
  { category: 'OPEN_SOURCE',    keywords: ['open source', 'open-source', 'github', 'hugging face', 'weights released', 'apache', 'mit license', 'community'] },
]

function preAssignCategory(title: string, content: string): SignalCategory {
  const text = `${title} ${content.slice(0, 500)}`.toLowerCase()
  for (const { category, keywords } of CATEGORY_SIGNALS) {
    if (keywords.some((kw) => text.includes(kw))) {
      return category
    }
  }
  return 'COMPANIES' // Default fallback
}

// ── Signal Engine Result ──────────────────────────────────────────────────────

export interface SignalEngineResult {
  observationId: string
  outcome:
    | 'signal_created'
    | 'rejected_duplicate'
    | 'rejected_marketing'
    | 'rejected_validation'
    | 'rejected_low_score'
    | 'error'
  signalId?: string | undefined
  reason?: string | undefined
  scores?: { signal_score: number; confidence_score: number; momentum_score: number } | undefined
}

// ── Main Engine Function ──────────────────────────────────────────────────────

export async function processObservation(
  observation: ObservationRow,
  sourceTrustScore: number,
  sourceName: string,
  sourceType: string = '',
): Promise<SignalEngineResult> {
  const supabase = createAdminClient()

  // ── Step 1: Category pre-assignment ────────────────────────────────────────
  const candidateCategory = preAssignCategory(observation.title, observation.content)

  // ── Step 2: Layer 1 deduplication (pre-enrichment, free) ──────────────────
  const dupCheck = await checkDuplicate(observation.title, candidateCategory)
  if (dupCheck.isDuplicate) {
    return {
      observationId: observation.id,
      outcome: 'rejected_duplicate',
      reason: dupCheck.reason,
    }
  }

  // ── Step 3: Get recent signal titles for novelty context ──────────────────
  const recentTitles = await getRecentSignalTitles(candidateCategory, 20)

  // ── Step 4: AI Enrichment (one OpenRouter call) ───────────────────────────
  const prompt = buildEnrichmentPrompt({
    title:              observation.title,
    content:            observation.content,
    sourceUrl:          (observation.metadata['feed_url'] as string | undefined) ?? '',
    sourceName,
    sourceTrustScore,
    candidateCategory,
    recentSignalTitles: recentTitles,
  })

  let enriched
  try {
    enriched = await agentCompleteJSON('parser', 
      [
        { role: 'system', content: ENRICHMENT_SYSTEM_PROMPT },
        { role: 'user',   content: prompt },
      ],
      EnrichmentOutputSchema,
      { temperature: 0, maxTokens: 1200 },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Enrichment failed'
    return { observationId: observation.id, outcome: 'error', reason: message }
  }

  // ── Step 5: Reject marketing content ──────────────────────────────────────
  if (enriched.is_marketing) {
    return {
      observationId: observation.id,
      outcome: 'rejected_marketing',
      reason: 'REJECT: marketing_content_detected (agent flag)',
    }
  }

  // ── Step 6: Reject duplicates flagged by agent ────────────────────────────
  if (enriched.is_duplicate) {
    return {
      observationId: observation.id,
      outcome: 'rejected_duplicate',
      reason: `REJECT: duplicate_flagged_by_agent — ${enriched.duplicate_note ?? ''}`,
    }
  }

  // ── Step 7: Validate raw factors ──────────────────────────────────────────
  const factors = {
    impact_factor:              enriched.impact_factor,
    actor_factor:               enriched.actor_factor,
    novelty_factor:             enriched.novelty_factor,
    verifiability_factor:       enriched.verifiability_factor,
    strategic_factor:           enriched.strategic_factor,
    authority_factor:           enriched.authority_factor,
    corroboration_factor:       enriched.corroboration_factor,
    specificity_factor:         enriched.specificity_factor,
    category_confidence_factor: enriched.category_confidence_factor,
    consistency_factor:         7, // Default for first 30 days (Signal Spec 6.6)
  }

  // ── Step 6.5: Override authority_factor by source type (more reliable than LLM) ─
  const SOURCE_AUTHORITY: Record<string, number> = {
    'company_blog': 10,  // OpenAI, Anthropic, Google, Meta official blogs
    'research':     7,   // arXiv preprints
    'technical':    6,   // GitHub Blog, HuggingFace Blog
    'news':         5,   // Tech media
    'community':    3,   // Forums, aggregators
  }
  const srcType  = sourceType.toLowerCase()
  const authOver = SOURCE_AUTHORITY[srcType]
  if (authOver !== undefined) {
    factors.authority_factor = authOver
  }

  const factorErrors = validateFactors(factors)
  if (factorErrors.length > 0) {
    return {
      observationId: observation.id,
      outcome: 'error',
      reason: `Factor validation failed: ${factorErrors.join(', ')}`,
    }
  }

  // ── Step 8: Server-side score computation ─────────────────────────────────
  // CRITICAL: scores computed here, never by the agent
  const { signal_score, confidence_score } = computeAllScores(factors)

  // Initial momentum: single source, newly collected
  const momentum_score = computeMomentumScore({
    newObservationsCount:  1,
    distinctSourceCount:   1,
    crossCategoryRefCount: 0,
    daysSinceCreation:     0,
  })

  // ── Step 9: Signal validation (VAL-01 through VAL-12) ────────────────────
  const validation = validateSignal({
    title:            enriched.title,
    description:      enriched.description,
    signal_score,
    confidence_score,
    category:         enriched.category,
    observation_ids:  [observation.id],
    entities:         enriched.entities,
  })

  if (!validation.valid) {
    const outcome = validation.canRetry ? 'rejected_validation' : 'rejected_low_score'
    return {
      observationId: observation.id,
      outcome,
      reason: validation.rejectionReason,
    }
  }

  // ── Step 10: Resolve / create entity records ──────────────────────────────
  const entityIds: string[] = []
  for (const entity of enriched.entities) {
    const canonicalName = entity.name
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim()

    // Upsert entity — canonical_name is the unique key
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: entityRecord } = await (supabase as any)
      .from('entities')
      .upsert(
        {
          name:           entity.name,
          canonical_name: canonicalName,
          entity_type:    entity.type,
        },
        { onConflict: 'canonical_name', ignoreDuplicates: false },
      )
      .select('id')
      .single()

    if (entityRecord?.id) {
      entityIds.push(entityRecord.id as string)
    }
  }

  // ── Step 11: Create Signal record ─────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: signal, error: signalError } = await (supabase as any)
    .from('signals')
    .insert({
      title:       enriched.title,
      description: enriched.description,
      category:    enriched.category,
      status:      'ACTIVE',

      // Raw factors
      ...factors,

      // Computed scores
      signal_score,
      confidence_score,
      momentum_score,

      // Lifecycle
      validation_flags: validation.flags,
      manual_override:  false,
      observation_ids:  [observation.id],
      entity_ids:       entityIds,

      momentum_last_calculated: new Date().toISOString(),

      metadata: {
        enrichment_model: serverEnv.OPENROUTER_MODEL,
        enriched_at:      new Date().toISOString(),
        novelty_prior_example: enriched.novelty_prior_example ?? null,
        momentum_calculation: {
          new_observations_count:   1,
          distinct_source_count:    1,
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

  return {
    observationId: observation.id,
    outcome:       'signal_created',
    signalId:      signal.id as string,
    scores:        { signal_score, confidence_score, momentum_score },
  }
}
