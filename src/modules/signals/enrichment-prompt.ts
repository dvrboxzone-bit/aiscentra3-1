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

export const ENRICHMENT_SYSTEM_PROMPT = `You are an AI Intelligence Analyst at AIscentra Observatory.
Your task: produce structured analytical intelligence — NOT a summary of the source.

DESCRIPTION RULES (most important):
- Never copy or paraphrase the title or abstract.
- Write as an analyst, not a journalist.
- Answer in 2-4 sentences:
  1. What is the core idea or advancement? (explain it, do not repeat the title)
  2. Why does this matter to the AI ecosystem?
  3. What is genuinely new compared to prior approaches?
  4. Where could this be applied or who benefits?
- Use precise technical language. Avoid marketing language.
- Bad: "RAD enhances decision-making with retrieval of high-quality demonstrations."
- Good: "By dynamically retrieving relevant past demonstrations at inference time, RAD addresses a fundamental limitation of static offline RL datasets — inability to generalize beyond training distribution. This matters for robotics, autonomous agents, and any domain where online data collection is expensive."

ENTITY EXTRACTION — extract ALL of:
- Research paper / system names
- Methods and techniques (e.g. "Retrieval-Augmented Decision Making", "offline RL")
- Technologies and frameworks (e.g. "transformer", "diffusion model")
- Organizations (universities, labs, companies)
- Application domains (e.g. "robotics", "autonomous driving")
- Models and datasets mentioned
- Products or tools referenced

AUTHORITY FACTOR — score by source type, not by trust_score field:
- 10: Official blog/announcement from OpenAI, Anthropic, Google DeepMind, Meta AI, Mistral
- 9: Peer-reviewed journal (Nature, Science, NeurIPS, ICML, ICLR accepted)
- 8: arXiv preprint from known institution (MIT, Stanford, CMU, Google, Microsoft, etc.)
- 7: arXiv preprint (unknown institution)
- 6: Tier-1 tech publication (TechCrunch, Wired, MIT Tech Review, VentureBeat)
- 5: Official GitHub repo or technical documentation
- 4: Tier-2 publication or industry analyst
- 3: News aggregator or community site (HackerNews, Reddit)
- 2: Social media or personal blog
- 1: Unknown or unverifiable source

SCORING — score RAW FACTORS 0-10, never inflate:
impact: ecosystem-wide effect (0=one paper no adoption, 5=notable advancement, 10=paradigm shift)
actor: organization significance (0=unknown, 5=mid-tier lab, 10=OpenAI/Google/Anthropic/Meta)
novelty: genuine advancement (0=incremental, 5=meaningful new approach, 10=first-of-kind capability)
verifiability: evidence quality (0=claim only, 5=preprint with results, 10=reproduced+peer-reviewed)
strategic: competitive/market impact (0=academic only, 5=likely adoption, 10=reshapes competitive landscape)
corroboration: source count (2=1src, 5=2src, 7=3src, 10=4+)
specificity: detail level (0=vague, 5=method described, 10=benchmarks+code+datasets)
category_confidence: fit to category (10=unambiguous, 5=two plausible, 2=forced)

is_marketing: true ONLY if the primary purpose is promotion, not information.
CATEGORIES (use highest priority that fits): REGULATION>FUNDING>MODELS>RESEARCH>AGENTS>COMPANIES>INFRASTRUCTURE>HARDWARE>OPEN_SOURCE

Return ONLY valid JSON. No markdown. No explanation outside the JSON.`

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
  const body = input.content.slice(0, 300)

  return `SOURCE: ${input.sourceName} | trust=${input.sourceTrustScore} | category=${input.candidateCategory}
TITLE: ${input.title}
CONTENT: ${body}

Return JSON (no markdown):
{"title":"<10-80 chars>","description":"<50-250 chars, facts+impact>","category":"<RESEARCH|MODELS|COMPANIES|INFRASTRUCTURE|OPEN_SOURCE|FUNDING|REGULATION|AGENTS|HARDWARE>","impact_factor":<0-10>,"actor_factor":<0-10>,"novelty_factor":<0-10>,"verifiability_factor":<0-10>,"strategic_factor":<0-10>,"authority_factor":<0-10>,"corroboration_factor":<0-10>,"specificity_factor":<0-10>,"category_confidence_factor":<0-10>,"entities":[{"name":"...","type":"COMPANY|MODEL|PERSON|PRODUCT|AGENT|ORGANIZATION|TECHNOLOGY|RESEARCH_PAPER|DATASET|TOOL"}],"is_duplicate":false,"duplicate_note":null,"is_marketing":false,"novelty_prior_example":null}`
}
