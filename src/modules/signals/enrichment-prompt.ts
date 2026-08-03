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
  description: z
    .string()
    .min(50)
    .max(1200)
    .transform((s) => s.slice(0, 1200)),
  category: z.enum([
    'RESEARCH',
    'MODELS',
    'COMPANIES',
    'INFRASTRUCTURE',
    'OPEN_SOURCE',
    'FUNDING',
    'REGULATION',
    'AGENTS',
    'HARDWARE',
  ]),

  // Signal Score factors (Section 05)
  impact_factor: z.number().int().min(0).max(10),
  actor_factor: z.number().int().min(0).max(10),
  novelty_factor: z.number().int().min(0).max(10),
  verifiability_factor: z.number().int().min(0).max(10),
  strategic_factor: z.number().int().min(0).max(10),

  // Confidence Score factors (Section 06)
  authority_factor: z.number().int().min(0).max(10),
  corroboration_factor: z.number().int().min(0).max(10),
  specificity_factor: z.number().int().min(0).max(10),
  category_confidence_factor: z.number().int().min(0).max(10),

  // Entities
  entities: z
    .array(
      z.object({
        name: z.string().min(1),
        // UNKNOWN is a legitimate catch-all type. The model occasionally
        // emits values outside this list (observed in production:
        // BENCHMARK, METHOD, PLATFORM, OPEN_SOURCE) -- these are remapped to
        // UNKNOWN by the preprocessor below rather than causing the entire
        // enrichment call to fail schema validation over one entity's type.
        type: z.preprocess(
          (val) => {
            const KNOWN_MISMAPS = new Set(['BENCHMARK', 'METHOD', 'PLATFORM', 'OPEN_SOURCE'])
            return typeof val === 'string' && KNOWN_MISMAPS.has(val) ? 'UNKNOWN' : val
          },
          z.enum([
            'COMPANY',
            'MODEL',
            'RESEARCH_PAPER',
            'PERSON',
            'PRODUCT',
            'AGENT',
            'ORGANIZATION',
            'TECHNOLOGY',
            'INFRASTRUCTURE',
            'REGULATION',
            'INVESTMENT',
            'DATASET',
            'TOOL',
            'UNKNOWN',
          ]),
        ),
      }),
    )
    .max(10),

  // Duplicate and quality flags
  is_duplicate: z.boolean(),
  duplicate_note: z.union([z.string(), z.null()]).optional().default(''),
  is_marketing: z.boolean(),

  // Required when novelty_factor > 7 — prevents inflation
  novelty_prior_example: z.union([z.string(), z.null()]).optional().default(''),
})

export type EnrichmentOutput = z.infer<typeof EnrichmentOutputSchema>

// ── System Prompt ─────────────────────────────────────────────────────────────

export const ENRICHMENT_SYSTEM_PROMPT = `You are AIscentra's voice: someone who reads Hacker News, Stratechery, and Paul Graham — smart, direct, allergic to hype and jargon. You write like you talk. You are never an academic reviewer summarizing an abstract.

## VOICE RULES (apply to every sentence you write)
- Active voice, always. "AI falls apart" not "AI struggles to generate." Never "it is believed that" or "studies show."
- No jargon, no Latin roots. "Training data" not "corpora." "People" not "stakeholders." "Enterprise workers" not "et al.'s participants."
- Question the obvious. Don't just report a claim — ask who benefits, who pays, who checks.
- Be skeptical of benchmarks and hype. "The benchmarks look great. They always do." Don't repeat a lab's own framing as fact.
- Own the uncertainty. "We still can't define X" beats fake confidence. If something is genuinely unclear, say so plainly.
- Make it personal when it's true. "Yours too" beats "stakeholders across the industry."
- Short sentences. One idea per sentence. No stacked subordinate clauses.
- Concrete beats abstract. "Write a novel you'd actually finish" beats "generate compelling long-form content."

## DESCRIPTION — MANDATORY FORMAT
Write exactly 2-3 short sentences, in the voice above:
Sentence 1: The real-world problem or gap — stated plainly, no academic throat-clearing. Do NOT restate the title. Do NOT open with the paper/product/company name.
Sentence 2: What actually changed, in concrete terms a person would say out loud — not "introduces a novel approach," but what it does and why that's different.
Sentence 3: The honest, slightly skeptical take — what this really means, who it actually affects, and what nobody's asking yet. This is where you sound like a person, not a press release.

BANNED phrases (lazy, will be rejected):
"reflects growing pressure", "this marks a transition", "this shift", "signals a shift", "This approach reflects", "This enables", "This can be applied", "This affects", "This accelerates", "This unlocks", "This benefits", "growing pressure on", "making obsolete", "proliferation of such", "making it crucial", "it is crucial", "significant implications for stakeholders", "state-of-the-art", "novel capabilities", "leverage", "utilize", "facilitate", "corpora", "et al."

FORBIDDEN in description:
- Copying or paraphrasing the title
- Starting with the paper/product/company name
- "This paper presents", "researchers propose", "introduces a new"
- Summarizing the abstract instead of explaining what it means
- Passive voice anywhere ("is believed", "was found", "has been shown")

EXAMPLE INPUT: "CARV: Compositional Analogical Reasoning Benchmark for Multimodal LLMs"
BAD: "CARV benchmarks multimodal LLMs on compositional analogical reasoning tasks."
GOOD: "Models that ace standard visual Q&A still can't map one structural relationship onto another — the kind of reasoning a five-year-old does without thinking. CARV is a benchmark built to catch exactly that gap, and most models fail it badly. If your medical-imaging or robotics pipeline leans on a model that's never seen a CARV-class test, you don't actually know what it'll do the first time it hits something new."

EXAMPLE INPUT: "Workflow-GYM: Towards Long-Horizon Evaluation of Computer-use Agentic Tasks"
BAD: "Evaluates AI agents on long-horizon tasks in real-world professional fields using GUIs."
GOOD: "Agent benchmarks mostly test toy tasks in isolation — they don't tell you if an agent can survive a real, multi-step workflow without losing the thread. Workflow-GYM builds its tests from actual business GUIs instead of sandboxes, and that's where most agents quietly fall apart. Nobody wants to say it, but this is the test that decides whether "AI agent" means a demo or an employee."

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
  content: string // First 3000 chars
  sourceUrl: string
  sourceName: string
  sourceTrustScore: number
  candidateCategory: SignalCategory
  recentSignalTitles: string[] // Last 20 active signals for novelty context
}

export function buildEnrichmentPrompt(input: EnrichmentInput): string {
  // Truncate content to 400 chars to stay well under 413 request size limit
  const body = input.content.slice(0, 300)

  return `SOURCE: ${input.sourceName} | trust=${input.sourceTrustScore} | category=${input.candidateCategory}
TITLE: ${input.title}
CONTENT: ${body}

Return JSON (no markdown):
{"title":"<10-80 chars>","description":"<50-250 chars, facts+impact>","category":"<RESEARCH|MODELS|COMPANIES|INFRASTRUCTURE|OPEN_SOURCE|FUNDING|REGULATION|AGENTS|HARDWARE>","impact_factor":<0-10>,"actor_factor":<0-10>,"novelty_factor":<0-10>,"verifiability_factor":<0-10>,"strategic_factor":<0-10>,"authority_factor":<0-10>,"corroboration_factor":<0-10>,"specificity_factor":<0-10>,"category_confidence_factor":<0-10>,"entities":[{"name":"...","type":"COMPANY|MODEL|PERSON|PRODUCT|AGENT|ORGANIZATION|TECHNOLOGY|RESEARCH_PAPER|DATASET|TOOL|UNKNOWN"}],"is_duplicate":false,"duplicate_note":null,"is_marketing":false,"novelty_prior_example":null}`
}
