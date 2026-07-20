/**
 * AIscentra — Model Provider Layer
 *
 * Single source of truth for all AI models used in the platform.
 * Agents never reference model strings directly — they use AgentRole.
 *
 * Architecture:
 * - Models are configured here, not in agent code
 * - Each role has a primary model + fallback chain
 * - Swap models by changing this file or env vars — zero agent changes
 * - Free models may disappear; fallback chain handles that gracefully
 */

// ── Available free models on OpenRouter ──────────────────────────────────────

export const MODELS = {
  GEMMA_26B:  'google/gemma-4-26b-a4b-it:free',
  GEMMA_31B:  'google/gemma-4-31b-it:free',
  GPT_OSS_20B: 'openai/gpt-oss-20b:free',
} as const

export type ModelId = typeof MODELS[keyof typeof MODELS]

// ── Agent roles ───────────────────────────────────────────────────────────────

export type AgentRole =
  | 'editor'        // Articles, analytical materials, content structuring
  | 'parser'        // Data processing, classification, signal extraction
  | 'intelligence'  // Analytics, historical comparison, scenario generation
  | 'assistant'     // Site assistant, user queries

// ── Role → model mapping ──────────────────────────────────────────────────────
// Override any role via env: MODEL_EDITOR, MODEL_PARSER, MODEL_INTELLIGENCE, MODEL_ASSISTANT

const ROLE_CONFIG: Record<AgentRole, { primary: ModelId; fallback: ModelId[] }> = {
  editor: {
    primary:  MODELS.GEMMA_26B,
    fallback: [MODELS.GEMMA_31B, MODELS.GPT_OSS_20B],
  },
  parser: {
    primary:  MODELS.GPT_OSS_20B,
    fallback: [MODELS.GEMMA_26B, MODELS.GEMMA_31B],
  },
  intelligence: {
    primary:  MODELS.GEMMA_31B,
    fallback: [MODELS.GEMMA_26B, MODELS.GPT_OSS_20B],
  },
  assistant: {
    primary:  MODELS.GEMMA_26B,
    fallback: [MODELS.GEMMA_31B, MODELS.GPT_OSS_20B],
  },
}

// ── Env override map ──────────────────────────────────────────────────────────

const ENV_OVERRIDE: Record<AgentRole, string | undefined> = {
  editor:       process.env['MODEL_EDITOR'],
  parser:       process.env['MODEL_PARSER'],
  intelligence: process.env['MODEL_INTELLIGENCE'],
  assistant:    process.env['MODEL_ASSISTANT'],
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Get primary model for a given agent role.
 * Respects env overrides — set MODEL_EDITOR=... to swap without code changes.
 */
export function getModel(role: AgentRole): ModelId {
  const override = ENV_OVERRIDE[role]
  if (override) return override as ModelId
  return ROLE_CONFIG[role].primary
}

/**
 * Get full fallback chain for a role (primary first, then fallbacks).
 * Used by completeWithFallback() to try models in order.
 */
export function getModelChain(role: AgentRole): ModelId[] {
  const override = ENV_OVERRIDE[role]
  if (override) return [override as ModelId, ...ROLE_CONFIG[role].fallback]
  return [ROLE_CONFIG[role].primary, ...ROLE_CONFIG[role].fallback]
}
