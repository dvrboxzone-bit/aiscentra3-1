/**
 * AIscentra — Groq TPD (tokens-per-day) budget
 *
 * REAL INCIDENT, from Groq's own request logs (461 rows,
 * 2026-08-03 08:25:50Z .. 2026-08-08 12:19:44Z): 24 requests rejected
 * with HTTP 429, every one reading
 *   "...on tokens per day (TPD): Limit 100000, Used <N>, Requested <M>"
 * for llama-3.3-70b-versatile. Zero mention TPM.
 *
 * The binding constraint is a DAILY TOKEN budget. The codebase had no
 * concept of one: tpm-manager.ts tracks rolling per-MINUTE windows
 * only, so nothing anywhere could see a daily ceiling approaching.
 *
 * Design decisions and why:
 *
 * 1. PRIORITY. Signal Engine outranks the Assistant (owner decision).
 *    Signal Engine may spend up to the full limit; the Assistant may
 *    only spend what is left ABOVE the reserve. At a 0.90 reserve the
 *    Assistant is capped at 10% of the daily budget and is refused
 *    once that is gone -- BEFORE any Groq call is made, so a refused
 *    request costs zero tokens.
 *
 * 2. FAIL-CLOSED FOR THE ASSISTANT, FAIL-OPEN FOR THE ENGINE. If the
 *    budget state cannot be determined (database unreachable, RPC
 *    error), the Assistant is BLOCKED and the Signal Engine CONTINUES.
 *    This is deliberate and asymmetric: blocking the engine on a
 *    bookkeeping outage would halt the product's core function, while
 *    letting the Assistant through blind is exactly how the reserve
 *    gets silently eaten. Note this inverts the previous assistant
 *    quota's fail-open behaviour, which was written when the quota
 *    only protected a request count, not a shared token budget the
 *    core depends on.
 *
 * 3. ROLLING WINDOW, NOT CALENDAR DAY. Groq's own refusals say
 *    "Please try again in 24m44s" / "1m48s" -- times that do not
 *    align with a midnight reset, indicating a rolling window. A
 *    calendar-day counter would wrongly believe the budget had reset.
 *
 * 4. CONFIGURABLE LIMIT. 100,000 is Groq's CURRENT free-tier figure,
 *    read from env so a plan change or a second model does not require
 *    a code change.
 *
 * EXPLICIT ASSUMPTION, stated rather than hidden: this module counts
 * input+output tokens, which is >= whatever Groq itself counts. Groq's
 * exact accounting could not be reproduced from the logs -- summing
 * observed successful usage over a rolling 24h window peaks at ~119.6k
 * against a stated 100k limit, so Groq is evidently counting something
 * narrower or over a different boundary. Counting the larger figure
 * means this module reaches its ceiling EARLIER than Groq would, which
 * is the safe direction: it under-uses the budget rather than
 * overrunning it and taking 429s.
 */

/** Groq's free-tier TPD for llama-3.3-70b-versatile at time of writing. */
const DEFAULT_TPD_LIMIT = 100_000

/** Signal Engine's guaranteed share (owner decision: minimum 90%). */
const DEFAULT_SIGNAL_ENGINE_RESERVE = 0.9

export type BudgetConsumer = 'signal_engine' | 'assistant'

export interface BudgetDecision {
  allowed: boolean
  /** Tokens already consumed in the window, as observed at decision time. */
  usedTokens: number
  /** This consumer's effective ceiling. */
  ceilingTokens: number
  /** Populated only when allowed=false, for logging and user-facing copy. */
  reason?: 'reserve_exhausted' | 'budget_unavailable'
}

export function getTpdLimit(): number {
  const raw = process.env['GROQ_TPD_LIMIT']
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TPD_LIMIT
}

export function getSignalEngineReserve(): number {
  const raw = process.env['SIGNAL_ENGINE_TPD_RESERVE']
  const parsed = raw ? Number.parseFloat(raw) : Number.NaN
  // Clamped to [0.5, 0.99]: below 0.5 the "reserve" would no longer
  // guarantee the core majority of the budget, and 1.0 would leave the
  // Assistant mathematically unable to ever run.
  if (!Number.isFinite(parsed)) return DEFAULT_SIGNAL_ENGINE_RESERVE
  return Math.min(0.99, Math.max(0.5, parsed))
}

/**
 * Minimal shape this module calls. Deliberately loose, matching the
 * existing convention in src/modules/observations/queries.ts's
 * RetryQueryClient, so tests can supply a small hand-written mock.
 */
export interface BudgetRpcClient {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{
    data: Array<{ allowed: boolean; used_tokens: number; ceiling_tokens: number }> | null
    error: { message: string } | null
  }>
}

/**
 * Atomically checks the rolling-window budget and, if the spend fits
 * under this consumer's ceiling, records it in the SAME database
 * transaction (see consume_ai_token_budget in
 * supabase/migrations/20260808150000_create_ai_token_budget.sql).
 *
 * The check and the increment are a single round trip on purpose: a
 * separate read-then-write is a real race, and two concurrent
 * Assistant requests could each observe the same remaining headroom
 * and both proceed.
 */
export async function consumeTokenBudget(
  client: BudgetRpcClient,
  params: { model: string; consumer: BudgetConsumer; tokens: number },
): Promise<BudgetDecision> {
  const limit = getTpdLimit()
  const reserve = getSignalEngineReserve()

  try {
    const { data, error } = await client.rpc('consume_ai_token_budget', {
      p_model: params.model,
      p_consumer: params.consumer,
      p_tokens: params.tokens,
      p_limit: limit,
      p_reserve_ratio: reserve,
    })

    if (error || !data || data.length === 0) {
      return unavailable(params.consumer, error?.message ?? 'empty RPC response')
    }

    const row = data[0]
    if (!row) return unavailable(params.consumer, 'missing RPC row')

    return {
      allowed: row.allowed,
      usedTokens: row.used_tokens,
      ceilingTokens: row.ceiling_tokens,
      ...(row.allowed ? {} : { reason: 'reserve_exhausted' as const }),
    }
  } catch (err) {
    return unavailable(params.consumer, err instanceof Error ? err.message : String(err))
  }
}

/**
 * Budget state could not be determined. Asymmetric by design -- see
 * decision 2 in this module's docstring.
 */
function unavailable(consumer: BudgetConsumer, detail: string): BudgetDecision {
  const failClosed = consumer === 'assistant'
  console.error(
    `[token-budget] state unavailable for ${consumer}, ${failClosed ? 'BLOCKING (fail-closed)' : 'proceeding (fail-open)'}: ${detail}`,
  )
  return {
    allowed: !failClosed,
    usedTokens: 0,
    ceilingTokens: 0,
    ...(failClosed ? { reason: 'budget_unavailable' as const } : {}),
  }
}
