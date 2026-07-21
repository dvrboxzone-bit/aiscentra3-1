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
import { callProvider, callProviderJSON, AIProviderError, type AIMessage, type AIOptions, type AIResult } from './client'
import { getModelChain, type AgentRole } from './models'

export type { AgentRole, AIMessage, AIOptions, AIResult }

export type ErrorKind =
  | 'rate_limit'
  | 'server_error'
  | 'client_error'
  | 'json_parse'
  | 'validation'
  | 'unknown'

// ── Retry config ──────────────────────────────────────────────────────────────
const MAX_RETRIES    = 3
const BASE_BACKOFF   = 5_000   // 5s base
const MAX_BACKOFF    = 60_000  // 60s ceiling

function backoffMs(attempt: number, retryAfterMs?: number): number {
  if (retryAfterMs) return Math.min(retryAfterMs + 500, MAX_BACKOFF)
  return Math.min(BASE_BACKOFF * Math.pow(2, attempt), MAX_BACKOFF)
}

function classifyError(err: unknown): ErrorKind {
  if (err instanceof AIProviderError) {
    if (err.isRateLimit)   return 'rate_limit'
    if (err.isServerError) return 'server_error'
    return 'client_error'
  }
  if (err instanceof SyntaxError)  return 'json_parse'
  if (err instanceof z.ZodError)   return 'validation'
  return 'unknown'
}

// ── Core retry wrapper ────────────────────────────────────────────────────────

async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
): Promise<T> {
  let lastErr: unknown

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      const kind = classifyError(err)

      // Retry on: rate limit (429), server errors (5xx), payload too large (413 = Groq instability)
      const isRetryable = kind === 'rate_limit' || kind === 'server_error' ||
        (err instanceof AIProviderError && err.statusCode === 413)
      if (!isRetryable) throw err
      if (attempt === MAX_RETRIES) break

      const retryAfterMs = err instanceof AIProviderError ? err.retryAfterMs : undefined
      const delay = backoffMs(attempt, retryAfterMs)

      console.warn(`[${label}] ${kind} — retry ${attempt + 1}/${MAX_RETRIES} in ${delay}ms`)
      await new Promise(r => setTimeout(r, delay))
    }
  }

  throw lastErr
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function agentComplete(
  role:     AgentRole,
  messages: AIMessage[],
  options:  AIOptions = {},
): Promise<AIResult & { modelUsed: string; errorKind?: ErrorKind }> {
  const chain  = getModelChain(role)
  const errors: string[] = []

  for (const ref of chain) {
    const label = `agent:${role}/${ref.provider}/${ref.model}`
    try {
      const result = await withRetry(
        () => callProvider(ref, messages, options),
        label,
      )
      console.info(`[agent:${role}] ✓ ${ref.provider}/${ref.model} — ${result.tokensUsed} tokens`)
      return { ...result, modelUsed: `${ref.provider}/${ref.model}` }
    } catch (err) {
      const kind = classifyError(err)
      const msg  = err instanceof AIProviderError
        ? `${ref.provider}/${ref.model}: HTTP ${err.statusCode} — ${err.message.slice(0, 200)}`
        : `${ref.provider}/${ref.model}: ${String(err).slice(0, 200)}`
      errors.push(`[${kind}] ${msg}`)
      console.warn(`[agent:${role}] ✗ ${ref.provider}/${ref.model} (${kind}) — trying next`)
    }
  }

  throw new Error(`[agent:${role}] All models failed:\n${errors.join('\n')}`)
}

export async function agentCompleteJSON<T>(
  role:     AgentRole,
  messages: AIMessage[],
  schema:   z.ZodType<T>,
  options:  AIOptions = {},
): Promise<T & { _modelUsed?: string }> {
  const chain  = getModelChain(role)
  const errors: string[] = []

  for (const ref of chain) {
    const label = `agent:${role}/${ref.provider}/${ref.model}`
    try {
      const result = await withRetry(
        () => callProviderJSON(ref, messages, schema, options),
        label,
      )
      console.info(`[agent:${role}] ✓ JSON ${ref.provider}/${ref.model}`)
      return { ...result, _modelUsed: `${ref.provider}/${ref.model}` }
    } catch (err) {
      const kind = classifyError(err)
      const msg  = err instanceof AIProviderError
        ? `${ref.provider}/${ref.model}: HTTP ${err.statusCode}`
        : `${ref.provider}/${ref.model}: ${String(err).slice(0, 100)}`
      errors.push(`[${kind}] ${msg}`)
      console.warn(`[agent:${role}] ✗ JSON ${ref.provider}/${ref.model} (${kind})`)
    }
  }

  throw new Error(`[agent:${role}] All models failed:\n${errors.join('\n')}`)
}
