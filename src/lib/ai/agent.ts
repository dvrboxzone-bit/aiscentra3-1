/**
 * AIscentra — Agent Completion API
 *
 * Single import point for all AI agents.
 * Handles:
 * - Model chain fallback (primary → mini)
 * - Rate limit (429) retry with exponential backoff + Retry-After header
 * - Error classification: rate_limit | server_error | client_error | unknown
 * - Concurrency: sequential by design (one request at a time per agent call)
 */
import { z } from 'zod'
import {
  callProvider,
  callProviderJSON,
  AIProviderError,
  type AIMessage,
  type AIOptions,
  type AIResult,
} from './client'
import { withModelQueue, AIRequestTooLargeError } from './tpm-manager'
import { getModelChain, type AgentRole } from './models'
import { ensureTimeLeft, sleepWithDeadline, AIDeadlineExceededError } from './deadline'
import {
  reserveBudgetForCall,
  consumerForRole,
  estimateInputTokens,
  AITokenBudgetExceededError,
} from './budget-gate'
import {
  AIStructuredOutputChainError,
  AIStructuredOutputError,
  type StructuredOutputDiagnostic,
} from './structured-output'

export { AIStructuredOutputChainError } from './structured-output'

export type { AgentRole, AIMessage, AIOptions, AIResult }

export type ErrorKind =
  | 'rate_limit'
  | 'server_error'
  | 'client_error'
  | 'json_parse'
  | 'schema_validation'
  | 'output_truncated'
  /** REAL PRODUCTION INCIDENT this closes: distinguishes "this request
   * is physically too large for this model's own TPM budget, no
   * amount of waiting or retrying would ever help" from a generic
   * 'unknown' error. Without this, chain exhaustion caused entirely
   * by AIRequestTooLargeError on every model was indistinguishable
   * from any other permanent failure, so callers could not tell
   * "requeue this, a larger/different model might handle it later"
   * apart from "this content is genuinely rejectable." */
  | 'request_too_large'
  | 'unknown'

// ── Retry config ──────────────────────────────────────────────────────────────
const MAX_RETRIES = 3
const BASE_BACKOFF = 5_000 // 5s base
const MAX_BACKOFF = 60_000 // 60s ceiling

function backoffMs(attempt: number, retryAfterMs?: number): number {
  if (retryAfterMs) return Math.min(retryAfterMs + 500, MAX_BACKOFF)
  return Math.min(BASE_BACKOFF * Math.pow(2, attempt), MAX_BACKOFF)
}

function classifyError(err: unknown): ErrorKind {
  if (err instanceof AIRequestTooLargeError) return 'request_too_large'
  if (err instanceof AIStructuredOutputError) return err.diagnostic.failureType
  if (err instanceof AIProviderError) {
    if (err.isRateLimit) return 'rate_limit'
    if (err.isServerError) return 'server_error'
    return 'client_error'
  }
  if (err instanceof SyntaxError) return 'json_parse'
  if (err instanceof z.ZodError) return 'schema_validation'
  return 'unknown'
}

// ── Core retry wrapper ────────────────────────────────────────────────────────

async function withRetry<T>(fn: () => Promise<T>, label: string, deadlineAt: number): Promise<T> {
  let lastErr: unknown

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    ensureTimeLeft(deadlineAt, 1_000, `withRetry:${label}:attempt-${attempt}`)
    try {
      return await fn()
    } catch (err) {
      // A deadline failure from a deeper layer (TPM wait, model queue,
      // or the fetch's own AbortSignal) is never retried -- it is not
      // classified as retryable below anyway (classifyError only
      // recognizes AIProviderError/SyntaxError/ZodError), but this is
      // stated explicitly so the reason is visible in the code, not
      // just an emergent side effect of classification order.
      if (err instanceof AIDeadlineExceededError) throw err
      // A budget refusal is not a model failure: trying the next
      // model in the chain would spend the very budget just
      // refused. Propagate immediately.
      if (err instanceof AITokenBudgetExceededError) throw err

      lastErr = err
      const kind = classifyError(err)

      // Retry on: rate limit (429), server errors (5xx), payload too large (413 = Groq instability)
      const isRetryable =
        kind === 'rate_limit' ||
        kind === 'server_error' ||
        (err instanceof AIProviderError && err.statusCode === 413)
      if (!isRetryable) throw err
      if (attempt === MAX_RETRIES) break

      const retryAfterMs = err instanceof AIProviderError ? err.retryAfterMs : undefined
      const delay = backoffMs(attempt, retryAfterMs)

      console.warn(`[${label}] ${kind} — retry ${attempt + 1}/${MAX_RETRIES} in ${delay}ms`)
      await sleepWithDeadline(delay, deadlineAt, `withRetry:${label}:backoff`)
    }
  }

  throw lastErr
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function agentComplete(
  role: AgentRole,
  messages: AIMessage[],
  options: AIOptions = {},
  deadlineAt: number,
): Promise<AIResult & { modelUsed: string; errorKind?: ErrorKind }> {
  const chain = getModelChain(role)
  const errors: string[] = []
  const kinds: ErrorKind[] = []
  // REAL BUG FIXED (merge-blocking review): the real thrown error
  // OBJECT for each attempt was previously discarded entirely -- only
  // its classified `kind` string and a truncated message survived.
  // This made it impossible to re-throw the ORIGINAL
  // AIRequestTooLargeError (with its real model/estimatedTokens/
  // modelCeiling fields intact) when chain exhaustion ends on that
  // error specifically; a synthesized replacement with fabricated
  // zero values was thrown instead. `lastError` preserves the real
  // object from the most recent attempt.
  let lastError: unknown
  let maxRetryAfterMs: number | undefined

  for (const ref of chain) {
    ensureTimeLeft(deadlineAt, 2_000, `agentComplete:${role}:before-${ref.provider}/${ref.model}`)
    // NOTE: budget is NOT reserved here. See the reservation inside the
    // withModelQueue callback below -- it must run per PROVIDER ATTEMPT
    // (every retry and every fallback), not once per model, because
    // withRetry issues up to MAX_RETRIES+1 real Groq calls for a single
    // model. Reserving here would under-count 4 actual calls as 1.
    const label = `agent:${role}/${ref.provider}/${ref.model}`
    try {
      const result = await withRetry(
        () =>
          withModelQueue(
            ref.model,
            async () => {
              // One atomic reservation immediately before THIS provider
              // attempt. Keyed on ref.model, so an 8b role that has
              // escalated to its 70b fallback is charged to 70b.
              await reserveBudgetForCall({
                model: ref.model,
                consumer: consumerForRole(role),
                estimatedTokens: (options.maxTokens ?? 1000) + estimateInputTokens(messages),
              })
              return callProvider(ref, messages, options, deadlineAt)
            },
            deadlineAt,
          ),
        label,
        deadlineAt,
      )
      console.info(`[agent:${role}] ✓ ${ref.provider}/${ref.model} — ${result.tokensUsed} tokens`)
      return { ...result, modelUsed: `${ref.provider}/${ref.model}` }
    } catch (err) {
      // A deadline failure must propagate immediately, not be recorded
      // as "this model failed, try the next one" -- there is no time
      // left for a next model either, and doing so would silently
      // convert a time-budget failure into a generic chain-exhaustion
      // error, losing the distinction the caller needs to requeue
      // correctly rather than mark this permanently failed.
      if (err instanceof AIDeadlineExceededError) throw err
      // A budget refusal is not a model failure: trying the next
      // model in the chain would spend the very budget just
      // refused. Propagate immediately.
      if (err instanceof AITokenBudgetExceededError) throw err

      const kind = classifyError(err)
      kinds.push(kind)
      lastError = err
      if (err instanceof AIProviderError && err.retryAfterMs) {
        maxRetryAfterMs = Math.max(maxRetryAfterMs ?? 0, err.retryAfterMs)
      }
      const msg =
        err instanceof AIProviderError
          ? `${ref.provider}/${ref.model}: HTTP ${err.statusCode} — ${err.message.slice(0, 200)}`
          : `${ref.provider}/${ref.model}: ${String(err).slice(0, 200)}`
      errors.push(`[${kind}] ${msg}`)
      console.warn(`[agent:${role}] ✗ ${ref.provider}/${ref.model} (${kind}) — trying next`)
    }
  }

  // Chain-exhaustion classification (fixes silent conversion of temporary
  // rate-limit exhaustion into a permanent error): if EVERY model in the
  // chain failed specifically on rate limiting, the caller must still be
  // able to see that via `instanceof AIProviderError` + `isRateLimit` --
  // a bare Error here would make enrich/batch's retry-vs-permanent
  // classification always fall through to "permanent", even though the
  // provider itself said "try again later".
  if (kinds.length > 0 && kinds.every((k) => k === 'rate_limit')) {
    throw new AIProviderError(
      `[agent:${role}] All models rate-limited:\n${errors.join('\n')}`,
      chain[0]?.provider ?? 'groq',
      429,
      maxRetryAfterMs,
    )
  }

  // REAL BUG FIXED (merge-blocking review): the previous `kinds.every
  // ((k) => k === 'request_too_large')` check required EVERY model in
  // the chain to have failed the SAME way -- but the real diagnosed
  // incident chain is MIXED: 70b fails with 'client_error' (a genuine
  // HTTP 200 whose body fails JSON/Zod validation), THEN 8b fails with
  // 'request_too_large' (refused before any network call, since the
  // full 70b-sized prompt cannot fit 8b's own TPM budget). kinds here
  // would be ['client_error', 'request_too_large'] -- `every` is false,
  // so this branch was never reached, and the real
  // AIRequestTooLargeError silently fell through to the generic "All
  // models failed" bare Error below, defeating the whole point of a
  // distinguishable, requeue-able error type.
  //
  // Fixed: check only the LAST attempt in the chain (there is no
  // further fallback after it regardless of what happened earlier) and,
  // if it was request_too_large, re-throw the REAL, original
  // AIRequestTooLargeError object (lastError) rather than synthesizing
  // a new one with fabricated model/estimatedTokens/modelCeiling
  // values. Deliberately NOT `kinds.some(...)` -- that would also match
  // e.g. a chain where an EARLIER model hit request_too_large but the
  // LAST one failed for an unrelated reason (a real content/validation
  // problem with the smaller model itself), misclassifying a genuine
  // permanent failure as a requeue-able "physically too large"
  // condition.
  const lastKind = kinds[kinds.length - 1]
  if (lastKind === 'request_too_large' && lastError instanceof AIRequestTooLargeError) {
    throw lastError
  }

  throw new Error(`[agent:${role}] All models failed:\n${errors.join('\n')}`)
}

export async function agentCompleteJSON<T>(
  role: AgentRole,
  messages: AIMessage[],
  schema: z.ZodType<T>,
  options: AIOptions = {},
  deadlineAt: number,
): Promise<T & { _modelUsed?: string }> {
  const chain = getModelChain(role)
  const errors: string[] = []
  const kinds: ErrorKind[] = []
  const structuredDiagnostics: StructuredOutputDiagnostic[] = []
  // See agentComplete's identical comment above -- preserves the real
  // thrown error object for the most recent attempt.
  let lastError: unknown
  let maxRetryAfterMs: number | undefined

  for (const ref of chain) {
    ensureTimeLeft(
      deadlineAt,
      2_000,
      `agentCompleteJSON:${role}:before-${ref.provider}/${ref.model}`,
    )
    // NOTE: budget is NOT reserved here. See the reservation inside the
    // withModelQueue callback below -- it must run per PROVIDER ATTEMPT
    // (every retry and every fallback), not once per model, because
    // withRetry issues up to MAX_RETRIES+1 real Groq calls for a single
    // model. Reserving here would under-count 4 actual calls as 1.
    const label = `agent:${role}/${ref.provider}/${ref.model}`
    try {
      const result = await withRetry(
        () =>
          withModelQueue(
            ref.model,
            async () => {
              // See agentComplete above: one reservation per provider
              // attempt, keyed on the model actually being called.
              await reserveBudgetForCall({
                model: ref.model,
                consumer: consumerForRole(role),
                estimatedTokens: (options.maxTokens ?? 1000) + estimateInputTokens(messages),
              })
              return callProviderJSON(ref, messages, schema, options, deadlineAt)
            },
            deadlineAt,
          ),
        label,
        deadlineAt,
      )
      console.info(`[agent:${role}] ✓ JSON ${ref.provider}/${ref.model}`)
      return { ...result, _modelUsed: `${ref.provider}/${ref.model}` }
    } catch (err) {
      // See agentComplete's identical comment above: a deadline failure
      // must propagate immediately, not be treated as "try next model".
      if (err instanceof AIDeadlineExceededError) throw err
      // A budget refusal is not a model failure: trying the next
      // model in the chain would spend the very budget just
      // refused. Propagate immediately.
      if (err instanceof AITokenBudgetExceededError) throw err

      const kind = classifyError(err)
      kinds.push(kind)
      if (err instanceof AIStructuredOutputError) {
        structuredDiagnostics.push(err.diagnostic)
      }
      lastError = err
      if (err instanceof AIProviderError && err.retryAfterMs) {
        maxRetryAfterMs = Math.max(maxRetryAfterMs ?? 0, err.retryAfterMs)
      }
      const msg =
        err instanceof AIStructuredOutputError
          ? `${err.diagnostic.provider}/${err.diagnostic.model}: ${err.diagnostic.failureType} finish_reason=${err.diagnostic.finishReason ?? 'null'} content_length=${err.diagnostic.contentLength}`
          : err instanceof AIProviderError
          ? `${ref.provider}/${ref.model}: HTTP ${err.statusCode}`
          : `${ref.provider}/${ref.model}: ${String(err).slice(0, 100)}`
      errors.push(`[${kind}] ${msg}`)
      console.warn(`[agent:${role}] ✗ JSON ${ref.provider}/${ref.model} (${kind})`)
    }
  }

  // See agentComplete's identical comment above: preserve rate-limit
  // classification across full chain exhaustion so the caller can still
  // requeue this observation instead of marking it permanently failed.
  if (kinds.length > 0 && kinds.every((k) => k === 'rate_limit')) {
    throw new AIProviderError(
      `[agent:${role}] All models rate-limited (JSON):\n${errors.join('\n')}`,
      chain[0]?.provider ?? 'groq',
      429,
      maxRetryAfterMs,
    )
  }

  if (
    structuredDiagnostics.length === chain.length &&
    kinds.every(
      (kind) =>
        kind === 'json_parse' || kind === 'schema_validation' || kind === 'output_truncated',
    )
  ) {
    throw new AIStructuredOutputChainError(structuredDiagnostics, role)
  }

  // REAL BUG FIXED (merge-blocking review) -- see agentComplete's
  // identical comment above. This is the ACTUAL code path the real
  // incident went through: callProviderJSON (invoked here) is what
  // throws AIProviderError on a JSON-parse/schema-validation failure
  // of a genuinely-200 primary response, triggering the fallback to a
  // lower-TPM model with the same full prompt -- kinds here is
  // ['client_error', 'request_too_large'], MIXED, so the old
  // `kinds.every(...)` check never matched. Fixed the same way: check
  // only the LAST attempt, re-throw the real original
  // AIRequestTooLargeError object.
  const lastKind = kinds[kinds.length - 1]
  if (lastKind === 'request_too_large' && lastError instanceof AIRequestTooLargeError) {
    throw lastError
  }

  throw new Error(`[agent:${role}] All models failed:\n${errors.join('\n')}`)
}
