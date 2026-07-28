/**
 * AIscentra — TPM Budget Manager
 *
 * Prevents 429 rate_limit_exceeded by tracking token consumption
 * and enforcing per-minute budget before each LLM request.
 *
 * Groq limits (Free Tier):
 *   llama-3.1-8b-instant:   6,000 TPM
 *   llama-3.3-70b-versatile: 12,000 TPM
 *
 * Architecture:
 * - Token window: rolling 60-second window per model
 * - Before each request: check if estimated tokens fit in remaining budget
 * - If not: wait until window resets
 * - Sequential queue: one request at a time per model (no parallel calls)
 */

// ── TPM limits per model ──────────────────────────────────────────────────────

const TPM_LIMITS: Record<string, number> = {
  'llama-3.1-8b-instant':   6_000,
  'llama-3.3-70b-versatile': 12_000,
  'default':                 6_000,   // conservative fallback
}

const SAFETY_MARGIN = 0.85  // use only 85% of limit to avoid edge cases

// ── Token window tracking ─────────────────────────────────────────────────────

interface TokenEntry {
  timestamp: number   // ms
  tokens:    number
}

const tokenWindows = new Map<string, TokenEntry[]>()

function getWindowedTokens(model: string): number {
  const now     = Date.now()
  const cutoff  = now - 60_000  // 60 second rolling window
  const entries = (tokenWindows.get(model) ?? []).filter(e => e.timestamp > cutoff)
  tokenWindows.set(model, entries)
  return entries.reduce((sum, e) => sum + e.tokens, 0)
}

function recordTokens(model: string, tokens: number): void {
  const entries = tokenWindows.get(model) ?? []
  entries.push({ timestamp: Date.now(), tokens })
  tokenWindows.set(model, entries)
}

function getOldestEntry(model: string): TokenEntry | undefined {
  const entries = tokenWindows.get(model) ?? []
  return entries.reduce((oldest, e) =>
    !oldest || e.timestamp < oldest.timestamp ? e : oldest,
    undefined as TokenEntry | undefined,
  )
}

// ── Budget check ──────────────────────────────────────────────────────────────

export interface BudgetCheckResult {
  allowed:        boolean
  usedTokens:     number
  limitTokens:    number
  remainingTokens:number
  waitMs:         number   // how long to wait if not allowed
}

export function checkTPMBudget(model: string, estimatedTokens: number): BudgetCheckResult {
  const limit     = (TPM_LIMITS[model] ?? TPM_LIMITS['default']!) * SAFETY_MARGIN
  const used      = getWindowedTokens(model)
  const remaining = Math.max(0, limit - used)
  const allowed   = estimatedTokens <= remaining

  let waitMs = 0
  if (!allowed) {
    // Wait until oldest entry expires from window
    const oldest = getOldestEntry(model)
    if (oldest) {
      waitMs = Math.max(0, (oldest.timestamp + 60_000) - Date.now()) + 500
    } else {
      waitMs = 5_000
    }
  }

  return {
    allowed,
    usedTokens:      Math.round(used),
    limitTokens:     Math.round(limit),
    remainingTokens: Math.round(remaining),
    waitMs,
  }
}

// ── Wait for budget ───────────────────────────────────────────────────────────

export async function waitForTPMBudget(
  model:           string,
  estimatedTokens: number,
  maxWaitMs:       number = 120_000,
): Promise<void> {
  const start = Date.now()

  while (true) {
    const check = checkTPMBudget(model, estimatedTokens)
    if (check.allowed) return

    if (Date.now() - start > maxWaitMs) {
      console.warn(`[tpm-manager] Max wait exceeded for ${model}, proceeding anyway`)
      return
    }

    console.info(`[tpm-manager] TPM budget: ${check.usedTokens}/${check.limitTokens} used. Waiting ${check.waitMs}ms for ${model}`)
    await new Promise(r => setTimeout(r, check.waitMs))
  }
}

// ── Record actual token usage ─────────────────────────────────────────────────

export function recordActualTokens(model: string, inputTokens: number, outputTokens: number): void {
  recordTokens(model, inputTokens + outputTokens)
}

// ── Sequential queue per model ────────────────────────────────────────────────
// Ensures only one request at a time per model — prevents burst parallel calls

const modelQueues = new Map<string, Promise<void>>()

export async function withModelQueue<T>(
  model:   string,
  fn:      () => Promise<T>,
): Promise<T> {
  const prev = modelQueues.get(model) ?? Promise.resolve()

  let resolve!: () => void
  const next = new Promise<void>(r => { resolve = r })
  modelQueues.set(model, next)

  await prev
  try {
    return await fn()
  } finally {
    resolve()
  }
}
