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
  duplicate_note: z.union([z.string(), z.null()]).optional().default(''),
  is_marketing:   z.boolean(),

  // Required when novelty_factor > 7 — prevents inflation
  novelty_prior_example: z.union([z.string(), z.null()]).optional().default(''),
})

export type EnrichmentOutput = z.infer<typeof EnrichmentOutputSchema>

// ── System Prompt ─────────────────────────────────────────────────────────────

export const ENRICHMENT_SYSTEM_PROMPT = `AI signal extraction. Return ONLY valid JSON. No markdown. No explanation.
Score RAW FACTORS 0-10. Never inflate scores.
impact:0=one product,5=ecosystem,10=cross-cutting
actor:0=unknown,5=mid-tier,10=OpenAI/Anthropic/Google/Meta/gov
novelty:0=routine,5=notable,10=first-of-kind(set novelty_prior_example if >7)
verifiability:0=rumor,5=credible source,10=official+corroborated
strategic:0=none,5=segment,10=reshapes landscape
authority:10=actor blog,8=tier1 pub,6=tier2,5=analyst,2=social,1=unknown
corroboration:2=1src,5=2src,7=3src,10=4+
specificity:0=vague,5=named entities,10=dates+amounts
category_confidence:10=clear,5=two possible,2=ambiguous
is_marketing=true if content is promotional not informational
CATEGORIES(priority): REGULATION>FUNDING>MODELS>RESEARCH>AGENTS>COMPANIES>INFRASTRUCTURE>HARDWARE>OPEN_SOURCE`

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
  // Truncate content to 400 chars to stay well under 413 request size limit
  const body = input.content.slice(0, 400)

  return `SOURCE: ${input.sourceName} | trust=${input.sourceTrustScore} | category=${input.candidateCategory}
TITLE: ${input.title}
CONTENT: ${body}

Return JSON (no markdown):
{"title":"<10-80 chars>","description":"<50-250 chars, facts+impact>","category":"<RESEARCH|MODELS|COMPANIES|INFRASTRUCTURE|OPEN_SOURCE|FUNDING|REGULATION|AGENTS|HARDWARE>","impact_factor":<0-10>,"actor_factor":<0-10>,"novelty_factor":<0-10>,"verifiability_factor":<0-10>,"strategic_factor":<0-10>,"authority_factor":<0-10>,"corroboration_factor":<0-10>,"specificity_factor":<0-10>,"category_confidence_factor":<0-10>,"entities":[{"name":"...","type":"COMPANY|MODEL|PERSON|PRODUCT|AGENT|ORGANIZATION|TECHNOLOGY|RESEARCH_PAPER|DATASET|TOOL"}],"is_duplicate":false,"duplicate_note":null,"is_marketing":false,"novelty_prior_example":null}`
}
