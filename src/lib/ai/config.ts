/**
 * AIscentra — AI Provider Configuration
 *
 * The ONLY place in the codebase where model names and provider URLs appear.
 * Change models or add providers here — agents are never touched.
 *
 * Priority order:
 *   1. Environment variable override (MODEL_<ROLE> or AI_PRIMARY_MODEL)
 *   2. Config defaults below
 *
 * Adding a new provider:
 *   1. Add it to ProviderName
 *   2. Add its config to PROVIDER_CONFIG
 *   3. Implement its client in src/lib/ai/providers/<name>.ts
 *   4. Register it in src/lib/ai/router.ts
 *   No agent code changes required.
 */

// ── Provider names ────────────────────────────────────────────────────────────

export type ProviderName = 'groq' | 'openrouter' | 'gemini' | 'ollama'

// ── Provider connection config ────────────────────────────────────────────────

export interface ProviderConfig {
  baseUrl:    string
  apiKeyEnv:  string   // Name of env var holding the API key
  defaultModel: string // Used when role config doesn't specify
}

export const PROVIDER_CONFIG: Record<ProviderName, ProviderConfig> = {
  groq: {
    baseUrl:      'https://api.groq.com/openai/v1',
    apiKeyEnv:    'GROQ_API_KEY',
    defaultModel: process.env['AI_PRIMARY_MODEL'] ?? 'compound',
  },
  openrouter: {
    baseUrl:      'https://openrouter.ai/api/v1',
    apiKeyEnv:    'OPENROUTER_API_KEY',
    defaultModel: process.env['OPENROUTER_MODEL'] ?? 'google/gemma-4-31b-it:free',
  },
  gemini: {
    baseUrl:      'https://generativelanguage.googleapis.com/v1beta/openai',
    apiKeyEnv:    'GEMINI_API_KEY',
    defaultModel: process.env['GEMINI_MODEL'] ?? 'gemini-2.0-flash',
  },
  ollama: {
    baseUrl:      process.env['OLLAMA_BASE_URL'] ?? 'http://localhost:11434/v1',
    apiKeyEnv:    'OLLAMA_API_KEY',
    defaultModel: process.env['OLLAMA_MODEL'] ?? 'llama3.2',
  },
}

// ── Model reference: provider + model string ──────────────────────────────────

export interface ModelRef {
  provider: ProviderName
  model:    string
}

// ── Default models (read from env, fall back to hardcoded defaults) ───────────
// To change a model: set the env var in Vercel. No code change needed.

export const DEFAULT_MODELS = {
  // Primary: groq/compound — Production System, FREE, 200K TPM, 200 RPM
  // Agentic system with built-in web search and code execution
  // Override: set AI_PRIMARY_MODEL in Vercel env
  PRIMARY: {
    provider: 'groq' as ProviderName,
    model:    process.env['AI_PRIMARY_MODEL'] ?? 'groq/compound',
  },
  // Mini: groq/compound-mini — Production System, FREE, 200K TPM, 200 RPM
  // Lighter variant for classification, preprocessing, fast tasks
  // Override: set AI_MINI_MODEL in Vercel env
  MINI: {
    provider: 'groq' as ProviderName,
    model:    process.env['AI_MINI_MODEL'] ?? 'groq/compound-mini',
  },
} satisfies Record<string, ModelRef>
