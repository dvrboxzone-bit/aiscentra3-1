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

export type ProviderName = 'groq' | 'cloudflare' | 'openrouter' | 'gemini' | 'ollama'

// ── Provider connection config ────────────────────────────────────────────────

export interface ProviderConfig {
  baseUrl: string
  apiKeyEnv: string // Name of env var holding the API key
  defaultModel: string // Used when role config doesn't specify
}

export const PROVIDER_CONFIG: Record<ProviderName, ProviderConfig> = {
  groq: {
    baseUrl: 'https://api.groq.com/openai/v1',
    apiKeyEnv: 'GROQ_API_KEY',
    defaultModel: process.env['AI_PRIMARY_MODEL'] ?? 'openai/gpt-oss-120b',
  },
  // REAL INCIDENT this closes: Groq deprecated and shut down (HTTP 404
  // model_not_found) both previously-configured models
  // (llama-3.1-8b-instant, llama-3.3-70b-versatile) on 2026-08-16,
  // stopping all Signal generation. Cloudflare Workers AI is added here
  // as a genuinely independent second free provider (not merely a
  // second model on the same Groq account) -- confirmed directly
  // against developers.cloudflare.com: $0.011/1,000 Neurons, 10,000
  // Neurons/day free (no card required), and the model below
  // (`@cf/zai-org/glm-4.7-flash`) confirmed still on the free plan
  // after Cloudflare's 2026-07-28 access change that moved only 3
  // OTHER, newer flagship models behind Workers Paid.
  //
  // baseUrl embeds the real account ID directly (confirmed exact
  // format via developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility):
  // https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1 --
  // callProvider() in client.ts appends '/chat/completions' itself, so
  // this must NOT include that suffix.
  cloudflare: {
    baseUrl: `https://api.cloudflare.com/client/v4/accounts/${process.env['CLOUDFLARE_ACCOUNT_ID'] ?? ''}/ai/v1`,
    apiKeyEnv: 'CLOUDFLARE_API_TOKEN',
    defaultModel: process.env['CLOUDFLARE_MODEL'] ?? '@cf/zai-org/glm-4.7-flash',
  },
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    defaultModel: process.env['OPENROUTER_MODEL'] ?? 'google/gemma-4-31b-it:free',
  },
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    apiKeyEnv: 'GEMINI_API_KEY',
    defaultModel: process.env['GEMINI_MODEL'] ?? 'gemini-2.0-flash',
  },
  ollama: {
    baseUrl: process.env['OLLAMA_BASE_URL'] ?? 'http://localhost:11434/v1',
    apiKeyEnv: 'OLLAMA_API_KEY',
    defaultModel: process.env['OLLAMA_MODEL'] ?? 'llama3.2',
  },
}

// ── Model reference: provider + model string ──────────────────────────────────

export interface ModelRef {
  provider: ProviderName
  model: string
}

// ── Default models (read from env, fall back to hardcoded defaults) ───────────
// To change a model: set the env var in Vercel. No code change needed.

export const DEFAULT_MODELS = {
  // Primary: openai/gpt-oss-120b — Groq's official replacement for the
  // deprecated llama-3.3-70b-versatile (confirmed via
  // console.groq.com/docs/rate-limits Free Plan table: 30 RPM, 1,000
  // RPD, 8,000 TPM, 200,000 TPD -- no card required).
  // Override: set AI_PRIMARY_MODEL in Vercel env
  PRIMARY: {
    provider: 'groq' as ProviderName,
    model: process.env['AI_PRIMARY_MODEL'] ?? 'openai/gpt-oss-120b',
  },
  // Mini: openai/gpt-oss-20b — Groq's official replacement for the
  // deprecated llama-3.1-8b-instant (same real Free Plan limits as
  // gpt-oss-120b above: 8,000 TPM, 200,000 TPD).
  // Override: set AI_MINI_MODEL in Vercel env
  MINI: {
    provider: 'groq' as ProviderName,
    model: process.env['AI_MINI_MODEL'] ?? 'openai/gpt-oss-20b',
  },
  // Cloudflare fallback: a genuinely independent second free provider
  // (separate account, separate daily quota) for when Groq's own
  // 200,000 TPD is exhausted for the day -- not a second model on the
  // same Groq budget. See models.ts for where this is wired into each
  // role's real fallback chain.
  // Override: set AI_CLOUDFLARE_MODEL in Vercel env
  CLOUDFLARE_FALLBACK: {
    provider: 'cloudflare' as ProviderName,
    model: process.env['AI_CLOUDFLARE_MODEL'] ?? '@cf/zai-org/glm-4.7-flash',
  },
} satisfies Record<string, ModelRef>
