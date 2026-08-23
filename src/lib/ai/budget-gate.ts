/**
 * AIscentra — Budget gate wiring
 *
 * Bridges the pure budget logic in ./token-budget.ts to the real call
 * paths. Kept separate from token-budget.ts so that module stays free
 * of Supabase imports and remains trivially unit-testable.
 *
 * WHY THIS EXISTS: the budget module alone constrains nothing. An
 * audit of the first iteration of this work found the module was
 * imported by nothing but its own tests -- a library with no call
 * sites, enforcing no limit on any real request. This file is the
 * enforcement point.
 *
 * WHERE THE GATE RUNS, and why there:
 *
 * 1. src/lib/ai/agent.ts, INSIDE the per-model fallback loop. Not in
 *    client.ts and not once per logical request, because a single
 *    agentComplete() call may try several models in sequence: roles
 *    like `classifier` run on openai/gpt-oss-20b but declare
 *    openai/gpt-oss-120b as their FALLBACK (see models.ts). A
 *    cheap mini role that escalates is spending the scarce 120b budget,
 *    and gating once up-front with the primary model's name would
 *    miss exactly that. Gating per attempt, keyed on `ref.model`,
 *    charges each attempt to the model it actually uses.
 *
 * 2. src/app/api/assistant/route.ts, before its own fetch. The
 *    Assistant does NOT go through client.ts at all -- it calls
 *    api.groq.com directly -- so wiring only agent.ts would leave it
 *    entirely ungoverned once enabled.
 *
 * The Supabase client is imported lazily inside the function, never at
 * module scope: createAdminClient transitively imports config/env.ts,
 * whose top-level env object throws eagerly when
 * NEXT_PUBLIC_SUPABASE_URL is absent. A request refused by an earlier
 * guard must never trigger that.
 */
import { consumeTokenBudget, type BudgetConsumer, type BudgetDecision } from './token-budget'
import type { AIMessage } from './client'

/**
 * Rough input-token estimate from the actual prompt being sent.
 *
 * 4 chars/token is the usual Llama-family rule of thumb and, measured
 * against Groq's own billing for this project's real enrichment
 * prompt (~11,375 characters billed at ~2,492 input tokens, i.e.
 * ~4.56 chars/token), it over-estimates by roughly 14%. Erring high is
 * correct for budget RESERVATION: reserving slightly more than a call
 * will use makes the ceiling bind slightly early, whereas
 * under-reserving lets real spend exceed the limit and produce the
 * 429s this whole mechanism exists to prevent.
 *
 * Deliberately local to this file rather than shared with client.ts's
 * TPM estimation, which is a separate concern on a separate branch;
 * duplicating four lines is preferable to coupling the daily budget to
 * an unrelated in-flight change.
 */
export function estimateInputTokens(messages: AIMessage[]): number {
  const chars = messages.reduce((sum, m) => sum + m.content.length + m.role.length, 0)
  return Math.ceil(chars / 4)
}

/**
 * Thrown when the budget refuses a call. Deliberately NOT an
 * AIProviderError: no provider was contacted, and no provider failed.
 * Callers must be able to tell "we chose not to spend" apart from
 * "the provider rejected us", because the two require opposite
 * responses -- the former is a normal, expected steady state once the
 * daily budget is consumed, the latter is an incident.
 */
export class AITokenBudgetExceededError extends Error {
  constructor(
    message: string,
    public readonly model: string,
    public readonly consumer: BudgetConsumer,
    public readonly decision: BudgetDecision,
  ) {
    super(message)
    this.name = 'AI_TOKEN_BUDGET_EXCEEDED'
  }
}

/**
 * Checks and reserves budget for one upcoming Groq call.
 *
 * Returns normally when the call may proceed. Throws
 * AITokenBudgetExceededError when it may not -- callers MUST treat a
 * throw as "do not contact Groq", which is enforced structurally by
 * calling this before the request is issued rather than alongside it.
 *
 * Failure semantics are asymmetric and deliberate:
 *   - Assistant  -> fail-closed. Blocked when budget state is unknown.
 *   - Signal Engine -> fail-open, but ONLY for storage unavailability,
 *     and every such call is logged as unaccounted (see below). A
 *     normal, correctly-observed budget exhaustion is NOT storage
 *     failure and DOES stop the engine -- otherwise the ceiling would
 *     be advisory rather than real.
 */
export async function reserveGroqBudget(params: {
  model: string
  consumer: BudgetConsumer
  estimatedTokens: number
}): Promise<void> {
  const { createAdminClient } = await import('@/lib/supabase/server')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches this repo's existing convention for Supabase calls against tables without generated types.
  const client = createAdminClient() as any

  const decision = await consumeTokenBudget(client, {
    model: params.model,
    consumer: params.consumer,
    tokens: params.estimatedTokens,
  })

  if (decision.allowed) {
    if (decision.reason === undefined && decision.ceilingTokens === 0) {
      // Allowed with a zero ceiling means the budget state could not be
      // read and the caller was failed OPEN (Signal Engine only). This
      // call will consume real Groq tokens that no ledger row records,
      // so the accounting will under-count until storage recovers.
      // Logged as structured JSON so it is greppable and alertable
      // rather than buried in prose.
      console.error(
        JSON.stringify({
          event: 'ai_budget_unaccounted_call',
          severity: 'alert',
          model: params.model,
          consumer: params.consumer,
          estimated_tokens: params.estimatedTokens,
          reason: 'budget_storage_unavailable_fail_open',
          impact:
            'Groq call proceeds WITHOUT being recorded; TPD accounting under-counts until storage recovers.',
        }),
      )
    }
    return
  }

  throw new AITokenBudgetExceededError(
    `[budget] ${params.consumer} refused for ${params.model}: ${decision.reason} ` +
      `(used ${decision.usedTokens}/${decision.ceilingTokens})`,
    params.model,
    params.consumer,
    decision,
  )
}

/**
 * Maps an agent role to its budget consumer. Only the `assistant` role
 * is Assistant traffic; every other role is Signal Engine work
 * (enrichment, classification, events, reports), which holds priority.
 */
export function consumerForRole(role: string): BudgetConsumer {
  return role === 'assistant' ? 'assistant' : 'signal_engine'
}

// ── Test injection ────────────────────────────────────────────────────────────
//
// reserveGroqBudget performs a real Supabase round trip, which is
// correct in production but adds latency to every model attempt. That
// latency is invisible to normal assertions yet fatal to the
// deadline-contour tests, which measure elapsed time against
// millisecond-scale deadlines and legitimately need the gate out of
// the way.
//
// Rather than weakening the gate itself (e.g. skipping it when no
// backend is configured -- which would silently disable enforcement in
// any misconfigured production environment), the indirection below lets
// tests substitute a no-op while production always uses the real
// implementation.

type BudgetReserver = typeof reserveGroqBudget
let activeReserver: BudgetReserver = reserveGroqBudget

/** Production entry point. Always routes through the active reserver. */
export function reserveBudgetForCall(params: {
  model: string
  consumer: BudgetConsumer
  estimatedTokens: number
}): Promise<void> {
  return activeReserver(params)
}

/** @internal Test-only. Returns a restore function. */
export function __setBudgetReserverForTests(fn: BudgetReserver): () => void {
  const previous = activeReserver
  activeReserver = fn
  return () => {
    activeReserver = previous
  }
}
