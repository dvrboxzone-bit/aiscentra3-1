/**
 * AIscentra — OpenRouter Client
 *
 * Single integration point for all AI operations.
 * Budget constraints from Signal Scoring Specification v1.0:
 * - temperature: 0 (deterministic output required for scoring)
 * - model: pinned (scoring consistency across time)
 * - max_tokens: 1000 (sufficient for enrichment JSON response)
 *
 * All AI calls in the intelligence pipeline must be asynchronous.
 * This client is server-side only — never import in Client Components.
 */
import { serverEnv } from '@/config/env'
import { z } from 'zod'

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1'

// Response schema validation — prevents untyped AI output entering the system
const MessageResponseSchema = z.object({
  id: z.string(),
  choices: z.array(z.object({
    message: z.object({
      content: z.string(),
    }),
    finish_reason: z.string(),
  })),
  usage: z.object({
    prompt_tokens:     z.number(),
    completion_tokens: z.number(),
    total_tokens:      z.number(),
  }).optional(),
})

export type OpenRouterMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type OpenRouterOptions = {
  /** Override model for specific tasks. Default: OPENROUTER_MODEL env var */
  model?: string
  /** Override max tokens. Default: 1000 */
  maxTokens?: number
  /** Temperature. Default: 0 — Signal Spec requires deterministic output */
  temperature?: number
}

export type OpenRouterResult = {
  content: string
  tokensUsed: number
}

/**
 * Core completion function.
 * Used by: Signal Engine, Event Generator, Content Agent, Assistant.
 */
export async function complete(
  messages: OpenRouterMessage[],
  options: OpenRouterOptions = {},
): Promise<OpenRouterResult> {
  const model       = options.model       ?? serverEnv.OPENROUTER_MODEL
  const maxTokens   = options.maxTokens   ?? 1000
  const temperature = options.temperature ?? 0  // Deterministic by default

  const response = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${serverEnv.OPENROUTER_API_KEY}`,
      'Content-Type':  'application/json',
      'HTTP-Referer':  'https://aiscentra.com',
      'X-Title':       'AIscentra Intelligence Observatory',
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens:  maxTokens,
      temperature,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new OpenRouterError(
      `OpenRouter API error: ${response.status} ${response.statusText}\n${error}`,
      response.status,
    )
  }

  const raw = await response.json() as unknown
  const parsed = MessageResponseSchema.safeParse(raw)

  if (!parsed.success) {
    throw new OpenRouterError(
      `Invalid OpenRouter response structure: ${parsed.error.message}`,
      0,
    )
  }

  const content = parsed.data.choices[0]?.message.content
  if (!content) {
    throw new OpenRouterError('OpenRouter returned empty content', 0)
  }

  return {
    content,
    tokensUsed: parsed.data.usage?.total_tokens ?? 0,
  }
}

/**
 * JSON completion — parses and validates the response as JSON.
 * Signal Engine enrichment uses this pattern to get structured output.
 */
export async function completeJSON<T>(
  messages: OpenRouterMessage[],
  schema: z.ZodType<T>,
  options: OpenRouterOptions = {},
): Promise<T> {
  const result = await complete(messages, options)

  // Strip markdown code fences if model wraps JSON in them
  const cleaned = result.content
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    throw new OpenRouterError(
      `AI response was not valid JSON:\n${result.content.slice(0, 200)}`,
      0,
    )
  }

  const validated = schema.safeParse(parsed)
  if (!validated.success) {
    throw new OpenRouterError(
      `AI response failed schema validation: ${validated.error.message}`,
      0,
    )
  }

  return validated.data
}

export class OpenRouterError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message)
    this.name = 'OpenRouterError'
  }
}
