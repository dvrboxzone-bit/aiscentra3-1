/**
 * AIscentra — Groq Provider
 *
 * Groq uses OpenAI-compatible API.
 * Base URL: https://api.groq.com/openai/v1
 *
 * This is the primary AI provider for AIscentra MVP.
 * Server-side only — never import in Client Components.
 */
import { z } from 'zod'

const GROQ_BASE = 'https://api.groq.com/openai/v1'

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

export type AIMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type AIOptions = {
  model?:       string
  maxTokens?:   number
  temperature?: number
}

export type AIResult = {
  content:    string
  tokensUsed: number
  provider:   'groq'
}

export class GroqError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message)
    this.name = 'GroqError'
  }
}

/**
 * Core Groq completion function.
 */
export async function groqComplete(
  messages: AIMessage[],
  options:  AIOptions = {},
): Promise<AIResult> {
  const apiKey      = process.env['GROQ_API_KEY']
  const model       = options.model       ?? process.env['GROQ_MODEL'] ?? 'llama-3.3-70b-versatile'
  const maxTokens   = options.maxTokens   ?? 1000
  const temperature = options.temperature ?? 0

  if (!apiKey) {
    throw new GroqError('GROQ_API_KEY is not set', 0)
  }

  const response = await fetch(`${GROQ_BASE}/chat/completions`, {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type':  'application/json',
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
    throw new GroqError(
      `Groq API error: ${response.status} ${response.statusText}\n${error}`,
      response.status,
    )
  }

  const raw    = await response.json() as unknown
  const parsed = MessageResponseSchema.safeParse(raw)

  if (!parsed.success) {
    throw new GroqError(
      `Invalid Groq response structure: ${parsed.error.message}`,
      0,
    )
  }

  const content = parsed.data.choices[0]?.message.content
  if (!content) {
    throw new GroqError('Groq returned empty content', 0)
  }

  return {
    content,
    tokensUsed: parsed.data.usage?.total_tokens ?? 0,
    provider:   'groq',
  }
}

/**
 * JSON completion — parses and validates AI response as JSON.
 */
export async function groqCompleteJSON<T>(
  messages: AIMessage[],
  schema:   z.ZodType<T>,
  options:  AIOptions = {},
): Promise<T> {
  const result = await groqComplete(messages, options)

  const cleaned = result.content
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    throw new GroqError(
      `AI response was not valid JSON:\n${result.content.slice(0, 200)}`,
      0,
    )
  }

  const validated = schema.safeParse(parsed)
  if (!validated.success) {
    throw new GroqError(
      `AI response failed schema validation: ${validated.error.message}`,
      0,
    )
  }

  return validated.data
}
