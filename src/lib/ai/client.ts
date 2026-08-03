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
import { waitForTPMBudget, recordActualTokens } from './tpm-manager'
import { ensureTimeLeft, msUntilDeadline, AIDeadlineExceededError } from './deadline'

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
  const estimatedTokens = maxTokens + 1000 // conservative: max_output + typical_input
  await waitForTPMBudget(ref.model, estimatedTokens, deadlineAt)

  ensureTimeLeft(deadlineAt, 1_000, `callProvider:${ref.provider}/${ref.model}:pre-fetch`)

  // Real AbortSignal tied to the shared deadline -- a bare
  // `Promise.race` around this fetch would leave the underlying HTTP
  // request running and the connection held open; only an AbortSignal
  // passed into fetch() itself actually cancels it.
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
      signal: AbortSignal.timeout(msUntilDeadline(deadlineAt)),
    })
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      // AbortSignal.timeout() fired -- the deadline was reached
      // mid-flight, the request was genuinely cancelled (not merely
      // stopped awaiting), and this is a temporary condition, not a
      // provider failure.
      throw new AIDeadlineExceededError(
        `[deadline] callProvider:${ref.provider}/${ref.model}: fetch aborted at deadline`,
        `callProvider:${ref.provider}/${ref.model}:fetch-aborted`,
        deadlineAt,
      )
    }
    throw err
  }

  if (!response.ok) {
    const body = await response.text()
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

  const raw = (await response.json()) as unknown
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

  const cleaned = result.content
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    throw new AIProviderError(
      `Response was not valid JSON:\n${result.content.slice(0, 200)}`,
      ref.provider,
      0,
    )
  }

  const validated = schema.safeParse(parsed)
  if (!validated.success) {
    throw new AIProviderError(
      `Response failed schema validation: ${validated.error.message}`,
      ref.provider,
      0,
    )
  }

  return validated.data
}
