/**
 * AIscentra — Intelligence Agent Runtime: Groq Reasoning Engine
 *
 * Production `ReasoningEngine` implementation. Satisfies the exact same
 * interface as `MockReasoningEngine` (interfaces.ts:70-72) — zero new
 * methods, zero interface changes.
 *
 * Uses the project's EXISTING AI abstraction (`src/lib/ai/agent.ts` →
 * `agentCompleteJSON`) rather than a new HTTP client. This reuses:
 *   - Model chain fallback (primary → mini)
 *   - Retry with exponential backoff on 429/5xx/413
 *   - TPM budget management (sequential queue)
 *   - GROQ_API_KEY resolution from environment (PROVIDER_CONFIG.groq.apiKeyEnv)
 *
 * JSON-only, Zod-validated. No text parsing, no regexp. The LLM's raw
 * response is validated against `GroqReasoningOutputSchema` — if it does not
 * conform, `agentCompleteJSON` throws (caught upstream by the same error
 * handling `Execution.run()` already uses for any thrown tool error).
 *
 * Role used: 'analyzer' (already exists in src/lib/ai/models.ts as
 * "Signal Analyzer" — semantically fits reasoning over Observatory
 * evidence). No new AgentRole was added; zero changes to
 * src/lib/ai/models.ts were required.
 */
import { z } from 'zod'
import type { ReasoningEngine } from './interfaces'
import type { ReasoningInput, ReasoningResult, ReasoningClaim, ClaimType } from './types'

// ── Zod schema for the LLM's structured output ────────────────────────────────
// Mirrors ReasoningResult exactly, minus taskId/reasonedAt (set programmatically,
// not by the model — these are Runtime-owned metadata, not LLM output).

const ClaimTypeSchema = z.enum(['FACT', 'INFERENCE', 'GAP', 'HYPOTHESIS'])

const ReasoningClaimSchema = z.object({
  type:        ClaimTypeSchema,
  statement:   z.string().min(1),
  evidenceIds: z.array(z.string()).default([]),
  confidence:  z.number().int().min(0).max(10),
})

const GroqReasoningOutputSchema = z.object({
  summary:        z.string().min(1),
  claims:         z.array(ReasoningClaimSchema).default([]),
  gapsIdentified: z.array(z.string()).default([]),
  confidence:     z.number().int().min(0).max(10),
})

type GroqReasoningOutput = z.infer<typeof GroqReasoningOutputSchema>

// ── System prompt ──────────────────────────────────────────────────────────────
// Mirrors the epistemic contract already established by MockReasoningEngine
// and documented in AGENT_REASONING.md: FACT/INFERENCE/GAP tagging, gaps
// surfaced explicitly, no inference presented as fact.

const REASONING_SYSTEM_PROMPT = `You are the Intelligence Agent's reasoning core for AIscentra Observatory.

Given a task query and an assembled evidence context (observations, signals,
knowledge graph nodes, memory entries, entities, and explicitly flagged gaps),
produce a structured analytical result. Return ONLY valid JSON matching this
exact schema — no markdown, no prose outside the JSON:

{
  "summary": "<one paragraph synthesizing the evidence for the task query>",
  "claims": [
    {
      "type": "FACT" | "INFERENCE" | "GAP" | "HYPOTHESIS",
      "statement": "<the claim, in your own words>",
      "evidenceIds": ["<id of observation/signal/graph node/memory entry that supports this>"],
      "confidence": <integer 0-10>
    }
  ],
  "gapsIdentified": ["<any gap you found in the evidence, restated or new>"],
  "confidence": <integer 0-10, overall confidence in the summary>
}

RULES:
- type="FACT": directly stated in the provided evidence. Confidence should be high (7-10).
- type="INFERENCE": your own conclusion drawn from combining multiple evidence items. Never present as FACT. Confidence reflects genuine uncertainty (typically 3-6).
- type="GAP": evidence that is missing or explicitly flagged as unavailable in the context. Confidence is always 0 — a gap is not evidence.
- type="HYPOTHESIS": a speculative possibility not yet supported by evidence but worth flagging. Use sparingly. Confidence typically 1-3.
- Every claim with type FACT or INFERENCE must cite at least one id in evidenceIds if such an id exists in the provided context. If no specific id applies, use an empty array — never invent an id.
- If the context contains gaps (explicitly listed), include a GAP claim for each one AND include it in gapsIdentified.
- If observations and signals are both empty, your summary and claims must state that no Observatory evidence was found — do not fabricate evidence.
- Never state something as FACT that is not explicitly present in the provided context.`

// ── Prompt builder ──────────────────────────────────────────────────────────────

function buildReasoningPrompt(input: ReasoningInput): string {
  const { task, context } = input

  const observationsBlock = context.observations.length > 0
    ? context.observations.map(o => `  - [${o.id}] "${o.title}" (source: ${o.sourceName}): ${o.summary}`).join('\n')
    : '  (none)'

  const signalsBlock = context.signals.length > 0
    ? context.signals.map(s => `  - [${s.id}] "${s.title}" (${s.category}, score ${s.signalScore}, ${s.intelligenceType}): ${s.description}`).join('\n')
    : '  (none)'

  const graphBlock = context.graphNodes.length > 0
    ? context.graphNodes.map(g => `  - [${g.id}] ${g.nodeType}: "${g.label}"${g.description ? ` — ${g.description}` : ''}`).join('\n')
    : '  (none)'

  const memoryBlock = context.memoryEntries.length > 0
    ? context.memoryEntries.map(m => `  - [${m.id}] ${m.memoryType}: "${m.title}" — ${m.summary} (confidence ${m.confidence})`).join('\n')
    : '  (none)'

  const entitiesBlock = context.entities.length > 0
    ? context.entities.map(e => `  - [${e.id}] ${e.entityType}: "${e.canonicalName}"${e.description ? ` — ${e.description}` : ''}`).join('\n')
    : '  (none)'

  const gapsBlock = context.gaps.length > 0
    ? context.gaps.map(g => `  - ${g}`).join('\n')
    : '  (none)'

  return `TASK QUERY: "${task.query}"
TASK TYPE: ${task.type}

OBSERVATIONS:
${observationsBlock}

SIGNALS:
${signalsBlock}

KNOWLEDGE GRAPH NODES:
${graphBlock}

MEMORY ENTRIES:
${memoryBlock}

ENTITIES:
${entitiesBlock}

EXPLICITLY FLAGGED GAPS (from Context Loader):
${gapsBlock}

Produce your structured reasoning result as JSON.`
}

// ── GroqReasoningEngine ───────────────────────────────────────────────────────

export class GroqReasoningEngine implements ReasoningEngine {
  async reason(input: ReasoningInput): Promise<ReasoningResult> {
    // Dynamic import — keeps this file's static import graph free of any
    // dependency on src/lib/ai unless GroqReasoningEngine is actually
    // instantiated (e.g. MockReasoningEngine-only test runs never load it).
    const { agentCompleteJSON } = await import('../../../src/lib/ai/agent')

    const prompt = buildReasoningPrompt(input)

    const rawOutput = await agentCompleteJSON(
      'analyzer',
      [
        { role: 'system', content: REASONING_SYSTEM_PROMPT },
        { role: 'user',   content: prompt },
      ],
      GroqReasoningOutputSchema,
      { temperature: 0.2, maxTokens: 2000 },
    )

    // agentCompleteJSON<T> returns T & { _modelUsed?: string } — re-validate
    // through the schema to recover the exact GroqReasoningOutput shape with
    // all .default() fields guaranteed present (never undefined).
    const output: GroqReasoningOutput = GroqReasoningOutputSchema.parse(rawOutput)

    // Runtime-owned metadata (taskId, reasonedAt) — never produced by the LLM,
    // exactly mirroring how MockReasoningEngine assembles these fields.
    const claims: ReasoningClaim[] = output.claims.map(c => ({
      type:        c.type as ClaimType,
      statement:   c.statement,
      evidenceIds: c.evidenceIds,
      confidence:  c.confidence,
    }))

    return {
      taskId:         input.task.id,
      summary:        output.summary,
      claims,
      gapsIdentified: output.gapsIdentified,
      confidence:     output.confidence,
      reasonedAt:     new Date().toISOString(),
    }
  }
}
