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
  description: z.string().min(50).max(1200).transform(s => s.slice(0, 1200)),
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

export const ENRICHMENT_SYSTEM_PROMPT = `You are a senior AI intelligence analyst. Your output feeds a professional observatory platform. Quality is measured by analytical depth, not by how faithfully you reproduced the source.

## DESCRIPTION — MANDATORY FORMAT
Write exactly 2-3 sentences structured as follows:
Sentence 1: What ecosystem problem or limitation does this address? (Do NOT restate the title. Start from the broader context.)
Sentence 2: What is the specific approach or mechanism, and what makes it genuinely different from prior work?
Sentence 3: Concrete downstream effect — name a specific use case, product category, or industry outcome. NEVER use generic phrases like "benefits researchers", "improves AI systems", "enhances applications in various domains". Instead: "robotics teams can now train agents without expensive real-world data collection" or "code generation tools that adopt this benchmark will surface reasoning failures invisible in current evals".

FORBIDDEN in description:
- Copying or paraphrasing the title
- Starting with the paper/product/company name
- Phrases like "This paper presents", "researchers propose", "introduces a new"
- Summarizing what the abstract says
- Generic impact: "benefits X community", "improves various applications", "enhances AI systems"

EXAMPLE INPUT: "RAD: Retrieval High-quality Demonstrations to Enhance Decision-making"
BAD: "RAD enhances decision-making with retrieval of high-quality demonstrations in offline RL."
GOOD: "Offline reinforcement learning agents fail in production because static training datasets cannot cover the full range of real-world scenarios. RAD addresses this by retrieving relevant past demonstrations dynamically at inference time — effectively giving the agent an expanding behavioral library without online interaction. This unlocks RL for robotics and autonomous systems where collecting live experience is dangerous or expensive."

EXAMPLE INPUT: "Workflow-GYM: Towards Long-Horizon Evaluation of Computer-use Agentic Tasks"
BAD: "Evaluates AI agents on long-horizon tasks in real-world professional fields using GUIs."
GOOD: "Current agent benchmarks test isolated tasks on toy environments — they cannot predict whether an agent will succeed at the multi-step, context-dependent workflows that define real professional work. Workflow-GYM closes this gap with a benchmark built from actual GUI-driven business workflows, exposing failure modes invisible in short-horizon settings. Adoption of this benchmark would accelerate development of enterprise-grade agents capable of reliably replacing human operators in knowledge work."

## ENTITIES — extract ALL that are meaningful to the AI ecosystem:
- Research paper or system names (the subject being reported)
- Methods and techniques (e.g. "attention steering", "retrieval-augmented RL", "compositional reasoning")
- AI models mentioned by name
- Organizations (universities, companies, labs) — only if explicitly named in the content
- Application domains (e.g. "autonomous driving", "video editing", "medical imaging")
- Datasets and benchmarks referenced
- Products and tools

DO NOT include:
- The source publication itself (arXiv, GitHub, TechCrunch) as an entity
- Generic terms ("AI", "LLM", "deep learning") unless they are the specific subject
- Broad academic fields ("Computer Science", "Social Sciences") as RESEARCH_PAPER type

## AUTHORITY FACTOR — by source type:
10=OpenAI/Anthropic/Google DeepMind/Meta AI official channel
9=NeurIPS/ICML/ICLR/Nature accepted paper
8=arXiv preprint from top institution (MIT/Stanford/CMU/Google/Microsoft/DeepMind)
7=arXiv preprint unknown institution
6=Tier-1 tech media (MIT Tech Review, VentureBeat, Wired)
5=GitHub official repo or technical docs
4=Tier-2 media or analyst
3=Community (HackerNews, Reddit)
2=Social/personal blog
1=Unknown source

## SCORING (0-10 raw factors, never inflate):
impact: 0=niche paper no adoption, 5=notable ecosystem advancement, 10=paradigm shift
actor: 0=unknown, 5=mid-tier lab, 10=OpenAI/Anthropic/Google/Meta
novelty: 0=incremental, 5=meaningful new approach, 10=capability that did not exist
verifiability: 0=claim only, 5=preprint+results, 10=peer-reviewed+reproduced
strategic: 0=academic only, 5=likely industry adoption, 10=reshapes competitive landscape
corroboration: 2=1src, 5=2src, 7=3src, 10=4+
specificity: 0=vague, 5=method described, 10=benchmarks+code+datasets
category_confidence: 10=clear fit, 5=two possible, 2=ambiguous

is_marketing=true only if primary purpose is promotion not information.
CATEGORIES (highest priority wins): REGULATION>FUNDING>MODELS>RESEARCH>AGENTS>COMPANIES>INFRASTRUCTURE>HARDWARE>OPEN_SOURCE

Return ONLY valid JSON. No markdown. No text before or after the JSON object.`

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
