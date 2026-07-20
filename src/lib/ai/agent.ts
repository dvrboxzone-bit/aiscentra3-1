/**
 * AIscentra — Agent Completion API
 *
 * Single import point for all AI agents.
 * Agents declare their role — Provider Layer handles the rest.
 *
 * Usage:
 *   import { agentComplete, agentCompleteJSON } from '@/lib/ai/agent'
 *   const result = await agentComplete('analyzer', messages)
 *   const data   = await agentCompleteJSON('parser', messages, schema)
 *
 * Fallback flow:
 *   getModelChain(role) → [ModelRef, ModelRef, ...]
 *   Try each ref via callProvider() until one succeeds.
 *   Each ref can be a different provider — agents never know.
 */
import { z } from 'zod'
import { callProvider, callProviderJSON, AIProviderError, type AIMessage, type AIOptions, type AIResult } from './client'
import { getModelChain, type AgentRole } from './models'

export type { AgentRole, AIMessage, AIOptions, AIResult }

/**
 * Text completion with automatic provider/model fallback.
 */
export async function agentComplete(
  role:     AgentRole,
  messages: AIMessage[],
  options:  AIOptions = {},
): Promise<AIResult & { modelUsed: string }> {
  const chain  = getModelChain(role)
  const errors: string[] = []

  for (const ref of chain) {
    try {
      const result = await callProvider(ref, messages, options)
      console.info(`[agent:${role}] ${ref.provider}/${ref.model} — ${result.tokensUsed} tokens`)
      return { ...result, modelUsed: `${ref.provider}/${ref.model}` }
    } catch (err) {
      const msg = err instanceof AIProviderError
        ? `${ref.provider}/${ref.model}: HTTP ${err.statusCode} — ${err.message}`
        : `${ref.provider}/${ref.model}: ${String(err)}`
      errors.push(msg)
      console.warn(`[agent:${role}] fallback from ${ref.provider}/${ref.model}`)
    }
  }

  throw new Error(`[agent:${role}] All providers failed:\n${errors.join('\n')}`)
}

/**
 * JSON completion with automatic provider/model fallback.
 * Used by Signal Engine and structured-output agents.
 */
export async function agentCompleteJSON<T>(
  role:     AgentRole,
  messages: AIMessage[],
  schema:   z.ZodType<T>,
  options:  AIOptions = {},
): Promise<T & { _modelUsed?: string }> {
  const chain  = getModelChain(role)
  const errors: string[] = []

  for (const ref of chain) {
    try {
      const result = await callProviderJSON(ref, messages, schema, options)
      console.info(`[agent:${role}] JSON — ${ref.provider}/${ref.model}`)
      return { ...result, _modelUsed: `${ref.provider}/${ref.model}` }
    } catch (err) {
      const msg = err instanceof AIProviderError
        ? `${ref.provider}/${ref.model}: HTTP ${err.statusCode} — ${err.message}`
        : `${ref.provider}/${ref.model}: ${String(err)}`
      errors.push(msg)
      console.warn(`[agent:${role}] JSON fallback from ${ref.provider}/${ref.model}`)
    }
  }

  throw new Error(`[agent:${role}] All providers failed:\n${errors.join('\n')}`)
}
