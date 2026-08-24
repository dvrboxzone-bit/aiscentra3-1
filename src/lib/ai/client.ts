/**
 * AIscentra — Generic OpenAI-compatible HTTP Client
 *
 * Any provider with OpenAI-compatible API works with this client:
 * Groq, OpenRouter, Gemini (OpenAI mode), Ollama, Together AI, etc.
 *
 * Provider-specific details (URL, key) come from ProviderConfig.
 * This file contains zero model names and zero provider URLs.
 */
import { z } from 'zod'
import { PROVIDER_CONFIG, type ProviderName, type ModelRef } from './config'
import {
  waitForTPMBudget,
  recordActualTokens,
  fitsWithinModelTPM,
  AIRequestTooLargeError,
} from './tpm-manager'
import { ensureTimeLeft, msUntilDeadline, AIDeadlineExceededError } from './deadline'
import { AIStructuredOutputError } from './structured-output'

// ── Shared types ──────────────────────────────────────────────────────────────

export type AIMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type AIOptions = {
  maxTokens?: number
  temperature?: number
}

export type AIResult = {
  content: string
  finishReason: string | null
  contentLength: number
  tokensUsed: number
  provider: ProviderName
  model: string
}

// ── Error ─────────────────────────────────────────────────────────────────────

export class AIProviderError extends Error {
  constructor(
    message: string,
    public readonly provider: ProviderName,
    public readonly statusCode: number,
    public readonly retryAfterMs?: number, // from Retry-After header
  ) {
    super(message)
    this.name = 'AIProviderError'
  }

  get isRateLimit(): boolean {
    return this.statusCode === 429
  }
  get isServerError(): boolean {
    return this.statusCode >= 500
  }
}

// ── Response schema ───────────────────────────────────────────────────────────

const CompletionResponseSchema = z.object({
  choices: z.array(
    z.object({
      message: z.object({ content: z.string() }),
      finish_reason: z.string().optional(),
    }),
  ),
  usage: z
    .object({
      total_tokens: z.number(),
    })
    .optional(),
})

// ── Token estimation for TPM budgeting ────────────────────────────────────────

/**
 * Characters-per-token ratio used to estimate input size. 4 is the
 * long-standing rule of thumb for English text on Llama-family
 * tokenizers, and matches the same constant already used by
 * src/modules/signals/engine.ts's own MAX_INPUT_CHARS calculation --
 * keeping one shared assumption rather than two that can drift.
 */
const CHARS_PER_TOKEN = 4

/**
 * No additional safety multiplier is applied on top of CHARS_PER_TOKEN,
 * because the 4-chars-per-token ratio ALREADY over-estimates for this
 * project's actual traffic -- verified against Groq's own logs: the
 * enrichment request's real prompt measures ~11,375 characters and
 * Groq bills it at ~2,492 input tokens, i.e. ~4.56 chars/token. Divid-
 * ing by 4 therefore yields ~2,844 -- about 14% above the true figure.
 * Stacking a further multiplier on top would double-count the same
 * headroom and needlessly halve throughput.
 */

/**
 * Estimates total tokens (input + worst-case output) for one request,
 * for TPM budgeting purposes.
 *
 * REAL PRODUCTION INCIDENT this fixes: the previous implementation was
 * a fixed guess, `maxTokens + 1000`, whose comment described the 1000
 * as "typical_input". For the enrichment call (maxTokens = 1024) that
 * yields an estimate of 2,024 tokens. Groq's own request logs for
 * 2026-08-03..08 show the actual cost of that same call is ~2,492
 * input + ~178 output = ~2,670 tokens -- a 32% underestimate.
 *
 * Consequence, confirmed by those logs: with a 12,000 TPM limit and
 * the manager's own 0.85 safety margin (10,200 effective), the
 * underestimate let through ~5 requests/minute, which actually consumed
 * ~13,450 tokens/minute -- above the real 12,000 ceiling. Groq returned
 * 429 rate_limit_exceeded 19 times on 2026-08-07/08, after four
 * preceding days with zero. Daily volume was never the problem (peak 49
 * requests/day against a 1,000/day limit); the per-minute ceiling was.
 *
 * Root cause of the drift: the enrichment system prompt grew by roughly
 * 500 tokens when style constraints and few-shot examples were added
 * (measured directly in the same logs: average input rose from 1,997 on
 * 2026-08-03 to ~2,490 from 2026-08-05 onward). The fixed "+1000"
 * guess silently stopped matching reality, with no mechanism to notice.
 *
 * This implementation measures the ACTUAL prompt being sent instead of
 * guessing, so future prompt growth adjusts the estimate automatically
 * rather than silently re-breaking the TPM budget. Deliberately errs
 * high: over-estimating costs throughput, under-estimating costs
 * hard 429 failures and lost observations.
 */
export function estimateRequestTokens(messages: AIMessage[], maxTokens: number): number {
  const inputChars = messages.reduce((sum, m) => sum + m.content.length + m.role.length, 0)
  const estimatedInput = Math.ceil(inputChars / CHARS_PER_TOKEN)
  // Worst-case output: the model is permitted to emit up to maxTokens,
  // so budget for that rather than for the typical (smaller) response.
  return estimatedInput + maxTokens
}

// ── Deadline / abort classification ────────────────────────────────────────────

/**
 * Recognizes every shape an aborted/timed-out fetch or body-read can
 * take: `AbortSignal.timeout()` throws a `TimeoutError`-named error;
 * a manually aborted signal typically surfaces as `AbortError`; and
 * `signal.aborted` is checked directly as a fallback in case a given
 * runtime throws neither name for a given failure mode (e.g. some body
 * stream read errors). Any of these, at any point in the response
 * lifecycle (the initial fetch, reading an error body, reading and
 * parsing the success body), means the shared deadline was reached
 * mid-flight -- not a provider failure.
 */
function isAbortLikeError(err: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) return true
  return err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
}

// ── Core function ─────────────────────────────────────────────────────────────

export async function callProvider(
  ref: ModelRef,
  messages: AIMessage[],
  options: AIOptions = {},
  deadlineAt: number,
): Promise<AIResult> {
  const config = PROVIDER_CONFIG[ref.provider]
  const apiKey = process.env[config.apiKeyEnv]
  const maxTokens = options.maxTokens ?? 1000
  const temperature = options.temperature ?? 0

  if (!apiKey) {
    throw new AIProviderError(
      `${config.apiKeyEnv} is not set in environment variables`,
      ref.provider,
      0,
    )
  }

  // ── TPM Budget check — wait if limit would be exceeded ─────────────────────
  // Checked against the shared deadline before waiting AND again right
  // before the actual fetch, since the TPM wait itself can consume a
  // meaningful chunk of the remaining budget.
  ensureTimeLeft(deadlineAt, 2_000, `callProvider:${ref.provider}/${ref.model}:pre-tpm-wait`)
  const estimatedTokens = estimateRequestTokens(messages, maxTokens)

  // REAL PRODUCTION INCIDENT this closes: three genuine Groq 429s
  // (limit=6000, used=1154-1532, requested=5137-5144) traced to a
  // model-chain fallback sending the SAME full-size prompt built for a
  // higher-TPM primary model (llama-3.3-70b-versatile, 12,000 TPM) to
  // its much lower-TPM fallback (llama-3.1-8b-instant, 6,000 TPM) --
  // physically too large for the fallback model regardless of how much
  // of its per-minute budget happens to be free right now. Checked
  // BEFORE waitForTPMBudget: without this, an intrinsically-too-large
  // request would enter that function's wait loop, where checkTPMBudget
  // would report `allowed: false` forever (no amount of waiting shrinks
  // a request bigger than the model's entire budget), eventually either
  // hitting the real Groq 429 anyway (if waitForTPMBudget's own
  // maxWaitMs cap gives up and "proceeds anyway") or consuming the
  // caller's whole remaining deadline waiting for something that could
  // never happen. Refusing immediately, with a distinct error type the
  // caller can recognize, lets the caller requeue the underlying work
  // instead of burning a real provider call on a request Groq itself
  // would just reject.
  const tpmCheck = fitsWithinModelTPM(ref.model, estimatedTokens)
  if (!tpmCheck.fits) {
    throw new AIRequestTooLargeError(
      `[tpm] ${ref.provider}/${ref.model}: estimated request (${estimatedTokens} tokens) exceeds this model's entire TPM budget (${tpmCheck.modelCeiling}) -- cannot fit regardless of current usage or waiting`,
      ref.model,
      estimatedTokens,
      tpmCheck.modelCeiling,
    )
  }

  await waitForTPMBudget(ref.model, estimatedTokens, deadlineAt)

  ensureTimeLeft(deadlineAt, 1_000, `callProvider:${ref.provider}/${ref.model}:pre-fetch`)

  // Real AbortSignal tied to the shared deadline -- a bare
  // `Promise.race` around this fetch would leave the underlying HTTP
  // request running and the connection held open; only an AbortSignal
  // passed into fetch() itself actually cancels it. Kept as a named
  // variable (not inlined into the fetch call) so the REST of this
  // function's response lifecycle -- reading an error body, reading and
  // parsing the success body -- can also check the SAME signal, since
  // the deadline can just as easily be reached after headers arrive but
  // while the body is still streaming, not only during the initial
  // connection.
  const signal = AbortSignal.timeout(msUntilDeadline(deadlineAt))
  const deadlineFail = (context: string): AIDeadlineExceededError =>
    new AIDeadlineExceededError(
      `[deadline] callProvider:${ref.provider}/${ref.model}: ${context}`,
      `callProvider:${ref.provider}/${ref.model}:${context}`,
      deadlineAt,
    )

  let response: Response
  try {
    response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: ref.model,
        messages,
        max_tokens: maxTokens,
        temperature,
      }),
      signal,
    })
  } catch (err) {
    if (isAbortLikeError(err, signal)) throw deadlineFail('fetch-aborted')
    throw err
  }

  if (!response.ok) {
    // Headers arrived, but the deadline can still be reached while
    // reading the error body itself (a stalled/slow body stream on an
    // already-non-OK response) -- guarded the same way as the initial
    // fetch, not left to hang unbounded.
    let body: string
    try {
      body = await response.text()
    } catch (err) {
      if (isAbortLikeError(err, signal)) throw deadlineFail('error-body-read-aborted')
      throw err
    }

    const statusCode = response.status

    // Parse Retry-After header for 429 — providers often tell us when to retry
    const retryAfterHeader =
      response.headers.get('retry-after') ?? response.headers.get('x-ratelimit-reset-requests')
    const retryAfterMs = retryAfterHeader
      ? Math.ceil(parseFloat(retryAfterHeader) * 1000)
      : undefined

    const err = new AIProviderError(
      `${ref.provider} API error: ${statusCode} ${response.statusText}\n${body}`,
      ref.provider,
      statusCode,
      retryAfterMs,
    )
    throw err
  }

  // Same reasoning as the error-body read above -- the success body can
  // also stall mid-stream after headers/status arrived fine.
  let raw: unknown
  try {
    raw = await response.json()
  } catch (err) {
    if (isAbortLikeError(err, signal)) throw deadlineFail('success-body-read-aborted')
    throw err
  }
  const parsed = CompletionResponseSchema.safeParse(raw)

  if (!parsed.success) {
    throw new AIProviderError(
      `Invalid response from ${ref.provider}: ${parsed.error.message}`,
      ref.provider,
      0,
    )
  }

  const content = parsed.data.choices[0]?.message.content
  if (!content) {
    throw new AIProviderError(`${ref.provider} returned empty content`, ref.provider, 0)
  }

  const tokensUsed = parsed.data.usage?.total_tokens ?? 0
  // Record actual consumption in TPM window (estimate split if not available)
  const inputTokens = Math.round(tokensUsed * 0.7)
  const outputTokens = Math.round(tokensUsed * 0.3)
  recordActualTokens(ref.model, inputTokens, outputTokens)

  return {
    content,
    finishReason: parsed.data.choices[0]?.finish_reason ?? null,
    contentLength: content.length,
    tokensUsed,
    provider: ref.provider,
    model: ref.model,
  }
}

// ── JSON completion ───────────────────────────────────────────────────────────

export async function callProviderJSON<T>(
  ref: ModelRef,
  messages: AIMessage[],
  schema: z.ZodType<T>,
  options: AIOptions,
  deadlineAt: number,
): Promise<T> {
  const result = await callProvider(ref, messages, options, deadlineAt)

  if (result.finishReason === 'length') {
    throw new AIStructuredOutputError({
      provider: result.provider,
      model: result.model,
      failureType: 'output_truncated',
      finishReason: result.finishReason,
      contentLength: result.contentLength,
    })
  }

  const cleaned = result.content
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    throw new AIStructuredOutputError({
      provider: result.provider,
      model: result.model,
      failureType: 'json_parse',
      finishReason: result.finishReason,
      contentLength: result.contentLength,
    })
  }

  const validated = schema.safeParse(parsed)
  if (!validated.success) {
    throw new AIStructuredOutputError({
      provider: result.provider,
      model: result.model,
      failureType: 'schema_validation',
      finishReason: result.finishReason,
      contentLength: result.contentLength,
    })
  }

  return validated.data
}
