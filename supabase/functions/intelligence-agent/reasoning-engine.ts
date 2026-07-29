/**
 * AIscentra — Intelligence Agent Runtime: Reasoning Engine
 *
 * MockReasoningEngine — NO LLM calls. Produces a deterministic, evidence-linked
 * ReasoningResult purely from what is present in AgentContext. This satisfies
 * the "no LLM until Signal Engine integration is authorized" constraint while
 * allowing the full pipeline to be exercised end-to-end.
 *
 * A future GroqReasoningEngine (or similar) will implement the same
 * ReasoningEngine interface and can be swapped in without touching planner.ts,
 * execution.ts, or reflection.ts.
 */
import type { ReasoningEngine } from './interfaces'
import type { ReasoningInput, ReasoningResult, ReasoningClaim } from './types'

export class MockReasoningEngine implements ReasoningEngine {
  async reason(input: ReasoningInput): Promise<ReasoningResult> {
    const { task, context } = input
    const claims: ReasoningClaim[] = []

    // FACT claims — one per signal present, directly evidenced
    for (const signal of context.signals.slice(0, 5)) {
      claims.push({
        type:        'FACT',
        statement:   `Signal "${signal.title}" (score ${signal.signalScore}) is present in the Observatory under category ${signal.category}.`,
        evidenceIds: [signal.id],
        confidence:  9,
      })
    }

    // INFERENCE claim — if multiple signals share a category, note it as a pattern
    if (context.signals.length >= 2) {
      const categories = new Set(context.signals.map(s => s.category))
      if (categories.size === 1) {
        claims.push({
          type:        'INFERENCE',
          statement:   `All ${context.signals.length} retrieved signals fall under "${[...categories][0]}" — this MAY indicate concentrated activity in this category, but requires more observations to confirm as a trend.`,
          evidenceIds: context.signals.map(s => s.id),
          confidence:  5,
        })
      }
    }

    // GAP claims — surface explicitly, never hidden
    for (const gap of context.gaps) {
      claims.push({
        type:        'GAP',
        statement:   gap,
        evidenceIds: [],
        confidence:  0,
      })
    }

    if (context.observations.length === 0 && context.signals.length === 0) {
      claims.push({
        type:        'GAP',
        statement:   `No observations or signals were found relevant to "${task.query}". The Observatory may not yet have coverage of this topic.`,
        evidenceIds: [],
        confidence:  0,
      })
    }

    const overallConfidence = claims.length > 0
      ? Math.round(claims.reduce((sum, c) => sum + c.confidence, 0) / claims.length)
      : 0

    const summary = context.signals.length > 0
      ? `Found ${context.signals.length} relevant signal(s) and ${context.observations.length} observation(s) for "${task.query}". [MOCK REASONING — no LLM synthesis applied]`
      : `No Observatory evidence found for "${task.query}". [MOCK REASONING — no LLM synthesis applied]`

    return {
      taskId:         task.id,
      summary,
      claims,
      gapsIdentified: context.gaps,
      confidence:     overallConfidence,
      reasonedAt:     new Date().toISOString(),
    }
  }
}
