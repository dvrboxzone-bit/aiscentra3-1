/**
 * AIscentra — Signal Enrichment Prompt
 *
 * Implements the single-call enrichment pattern from Signal Scoring Spec v1.0, Section 16.4.
 * One OpenRouter call → all enrichment fields as validated JSON.
 *
 * temperature: 0 — deterministic output required (Signal Spec Section 16.4)
 * The agent NEVER sets final scores — only raw factors (0–10).
 * Server-side scoring.ts computes final signal_score and confidence_score.
 */
import { z } from 'zod'
import type { SignalCategory } from '@/types/database'

// ── Output Schema ─────────────────────────────────────────────────────────────
// Validated by Zod before any data enters the system

export const EnrichmentOutputSchema = z.object({
  // Signal identity
  title: z.string().min(10).max(80),
  description: z.string().min(50).max(500),
  category: z.enum([
    'RESEARCH', 'MODELS', 'COMPANIES', 'INFRASTRUCTURE',
    'OPEN_SOURCE', 'FUNDING', 'REGULATION', 'AGENTS', 'HARDWARE',
  ]),

  // Signal Score factors (Section 05)
  impact_factor:        z.number().int().min(0).max(10),
  actor_factor:         z.number().int().min(0).max(10),
  novelty_factor:       z.number().int().min(0).max(10),
  verifiability_factor: z.number().int().min(0).max(10),
  strategic_factor:     z.number().int().min(0).max(10),

  // Confidence Score factors (Section 06)
  authority_factor:           z.number().int().min(0).max(10),
  corroboration_factor:       z.number().int().min(0).max(10),
  specificity_factor:         z.number().int().min(0).max(10),
  category_confidence_factor: z.number().int().min(0).max(10),

  // Entities
  entities: z.array(z.object({
    name: z.string().min(1),
    type: z.enum([
      'COMPANY', 'MODEL', 'RESEARCH_PAPER', 'PERSON', 'PRODUCT',
      'AGENT', 'ORGANIZATION', 'TECHNOLOGY', 'INFRASTRUCTURE',
      'REGULATION', 'INVESTMENT', 'DATASET', 'TOOL',
    ]),
  })).max(10),

  // Duplicate and quality flags
  is_duplicate:   z.boolean(),
  duplicate_note: z.string().optional(),
  is_marketing:   z.boolean(),

  // Required when novelty_factor > 7 — prevents inflation
  novelty_prior_example: z.string().optional(),
})

export type EnrichmentOutput = z.infer<typeof EnrichmentOutputSchema>

// ── System Prompt ─────────────────────────────────────────────────────────────

export const ENRICHMENT_SYSTEM_PROMPT = `You are the Signal Enrichment Agent for AIscentra Intelligence Observatory.

Your task: analyze an AI ecosystem observation and extract structured intelligence.

CRITICAL RULES:
1. Return ONLY valid JSON matching the exact schema. No markdown, no explanation.
2. temperature is 0 — be consistent and deterministic.
3. You score RAW FACTORS (0–10), NOT final scores. Final scores are computed server-side.
4. Never inflate scores. A routine version update is NOT novel. An announcement is NOT significant impact without evidence.
5. If novelty_factor > 7, you MUST provide novelty_prior_example naming a prior comparable development.
6. is_marketing = true if primary purpose is promotion, not information.

SCORING GUIDELINES:

impact_factor (0–10):
  0–2: Affects one product or internal team only
  3–4: Affects a specific professional segment
  5–6: Meaningful ecosystem-wide visibility
  7–8: Changes how a significant portion of AI ecosystem operates
  9–10: Immediate cross-cutting implications for entire AI ecosystem

actor_factor (0–10):
  0–2: Unknown or unverified actor
  3–4: Minor recognized company or research group
  5–6: Established mid-tier company or regional body
  7–8: Top-tier AI lab, major cloud provider, significant government
  9–10: OpenAI, Anthropic, Google DeepMind, Meta AI, or major government (US/EU/China)

novelty_factor (0–10):
  0–2: Routine update, patch, or minor improvement
  3–4: Meaningful improvement, incremental
  5–6: Notable advancement extending existing capabilities
  7–8: Significant new capability or approach
  9–10: First-of-kind, capability class that did not previously exist

verifiability_factor (0–10):
  0–2: Rumor, speculation, or unverified claim
  3–4: Single secondary source, unconfirmed
  5–6: Credible secondary or one non-actor primary source
  7–8: Official statement from actor or multiple independent sources
  9–10: Official announcement + multiple independent corroborations

strategic_factor (0–10):
  0–2: Technical detail, no strategic dimension
  3–4: Minor strategic implication for one company
  5–6: Meaningful signal for a segment of the ecosystem
  7–8: Changes competitive dynamics or funding flows
  9–10: Reshapes AI ecosystem strategic landscape

authority_factor (0–10, based on source type):
  10: Actor's own official channel (blog, press page, SEC filing)
  8: Tier-1 verified industry publication
  6: Tier-2 industry publication
  5: Credible journalist or analyst with verified identity
  3: Aggregator or curator
  2: Community forum, social media, or anonymous source
  1: Unknown or unverifiable source

corroboration_factor (0–10, based on independent source count):
  2: 1 source only
  5: 2 independent sources
  7: 3 independent sources
  10: 4+ independent sources

specificity_factor (0–10):
  0–2: Vague, no verifiable specifics
  5–6: Some named entities or dates
  8–10: Named entities, specific dates, version numbers, dollar amounts

category_confidence_factor (0–10):
  10: Clearly maps to one category
  5: Could fit 2 categories
  2: Ambiguous, forced assignment

CATEGORY PRIORITY (when multiple could fit):
REGULATION > FUNDING > MODELS > RESEARCH > AGENTS > COMPANIES > INFRASTRUCTURE > HARDWARE > OPEN_SOURCE`

// ── User Prompt Builder ───────────────────────────────────────────────────────

export interface EnrichmentInput {
  title: string
  content: string          // First 3000 chars
  sourceUrl: string
  sourceName: string
  sourceTrustScore: number
  candidateCategory: SignalCategory
  recentSignalTitles: string[]  // Last 20 active signals for novelty context
}

export function buildEnrichmentPrompt(input: EnrichmentInput): string {
  const recentTitlesText = input.recentSignalTitles.length > 0
    ? `\nRECENT OBSERVATORY SIGNALS (for novelty assessment):\n${input.recentSignalTitles.map((t, i) => `${i + 1}. ${t}`).join('\n')}`
    : ''

  return `Analyze this AI ecosystem observation and return structured JSON.

SOURCE: ${input.sourceName} (${input.sourceUrl})
SOURCE TYPE: trust_score=${input.sourceTrustScore} → authority_factor should reflect this
CANDIDATE CATEGORY: ${input.candidateCategory}

TITLE: ${input.title}

CONTENT:
${input.content}
${recentTitlesText}

Return JSON matching this exact schema:
{
  "title": "Concise factual title 10-80 chars, no hedging words, no superlatives",
  "description": "2-3 sentences. Sentence 1: what happened (facts only). Sentence 2: why it matters to the AI ecosystem. Sentence 3 (optional): what to watch for.",
  "category": "ONE of: RESEARCH|MODELS|COMPANIES|INFRASTRUCTURE|OPEN_SOURCE|FUNDING|REGULATION|AGENTS|HARDWARE",
  "impact_factor": <integer 0-10>,
  "actor_factor": <integer 0-10>,
  "novelty_factor": <integer 0-10>,
  "verifiability_factor": <integer 0-10>,
  "strategic_factor": <integer 0-10>,
  "authority_factor": <integer 0-10>,
  "corroboration_factor": <integer 0-10>,
  "specificity_factor": <integer 0-10>,
  "category_confidence_factor": <integer 0-10>,
  "entities": [{"name": "...", "type": "COMPANY|MODEL|PERSON|..."}],
  "is_duplicate": false,
  "duplicate_note": null,
  "is_marketing": false,
  "novelty_prior_example": null
}

Return ONLY the JSON object. No markdown fences. No explanation.`
}
