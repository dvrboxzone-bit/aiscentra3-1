/**
 * AIscentra — Agent Completion Layer
 *
 * All agents use these functions — never `complete()` directly.
 * Handles model fallback automatically:
 * 1. Tries primary model
 * 2. On failure — tries next in chain
 * 3. If all fail — throws with aggregated errors
 *
 * Usage:
 *   import { agentComplete, agentCompleteJSON } from '@/lib/openrouter/agent'
 *   const result = await agentComplete('editor', messages)
 */
import { complete, completeJSON, OpenRouterError, type OpenRouterMessage, type OpenRouterOptions, type OpenRouterResult } from './client'
import { getModelChain, type AgentRole } from './models'
import { z } from 'zod'

export type { AgentRole }

/**
 * Complete with automatic model fallback.
 * Agents call this instead of complete() directly.
 */
export async function agentComplete(
  role: AgentRole,
  messages: OpenRouterMessage[],
  options: Omit<OpenRouterOptions, 'model'> = {},
): Promise<OpenRouterResult & { modelUsed: string }> {
  const chain  = getModelChain(role)
  const errors: string[] = []

  for (const model of chain) {
    try {
      const result = await complete(messages, { ...options, model })
      // Log which model was actually used (useful for monitoring)
      console.info(`[agent:${role}] completed with ${model} (${result.tokensUsed} tokens)`)
      return { ...result, modelUsed: model }
    } catch (err) {
      const msg = err instanceof OpenRouterError
        ? `${model}: HTTP ${err.statusCode} — ${err.message}`
        : `${model}: ${String(err)}`
      errors.push(msg)
      console.warn(`[agent:${role}] failed on ${model}, trying next...`)
    }
  }

  throw new Error(
    `[agent:${role}] All models failed:\n${errors.join('\n')}`
  )
}

/**
 * JSON completion with automatic model fallback.
 * Used by structured-output agents (Signal Engine, Parser).
 */
export async function agentCompleteJSON<T>(
  role: AgentRole,
  messages: OpenRouterMessage[],
  schema: z.ZodType<T>,
  options: Omit<OpenRouterOptions, 'model'> = {},
): Promise<T & { _modelUsed?: string }> {
  const chain  = getModelChain(role)
  const errors: string[] = []

  for (const model of chain) {
    try {
      const result = await completeJSON(messages, schema, { ...options, model })
      console.info(`[agent:${role}] JSON completed with ${model}`)
      return { ...result, _modelUsed: model }
    } catch (err) {
      const msg = err instanceof OpenRouterError
        ? `${model}: HTTP ${err.statusCode} — ${err.message}`
        : `${model}: ${String(err)}`
      errors.push(msg)
      console.warn(`[agent:${role}] JSON failed on ${model}, trying next...`)
    }
  }

  throw new Error(
    `[agent:${role}] All models failed:\n${errors.join('\n')}`
  )
}
