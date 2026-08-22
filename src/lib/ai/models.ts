/**
 * AIscentra — Agent Role → Model Mapping
 *
 * Agents declare their role. This file decides which ModelRef they get.
 * No model names here — only references to DEFAULT_MODELS from config.ts.
 *
 * To change a model: update AI_PRIMARY_MODEL or AI_MINI_MODEL in Vercel env.
 * To add a new role: add it to AgentRole and ROLE_CONFIG below.
 * To switch a role to another provider: change its ModelRef here.
 * Agents are never touched.
 */
import { DEFAULT_MODELS, type ModelRef } from './config'

// ── Agent roles ───────────────────────────────────────────────────────────────

export type AgentRole =
  // compound — deep reasoning, long-form, analysis
  | 'assistant' // Site Assistant
  | 'writer' // Insight Writer
  | 'analyzer' // Signal Analyzer
  | 'brief' // Daily Intelligence Brief
  | 'editor' // Editor Agent
  | 'strategy' // Strategy / Analysis Agent
  | 'parser' // Signal Engine enrichment (internal)
  // compound-mini — speed, classification, preprocessing
  | 'classifier' // Classification Agent
  | 'summarizer' // News Summarizer
  | 'translator' // Translation Agent
  | 'background' // Background Processing
  | 'metadata' // Metadata Extraction
  | 'tagger' // Tag Generation
  | 'preprocessor' // Fast preprocessing before main agent

// ── Role config ───────────────────────────────────────────────────────────────
// primary + fallback are ModelRef objects — provider + model, no raw strings.
// Fallback can be a different provider entirely (e.g. openrouter as backup).

interface RoleConfig {
  primary: ModelRef
  fallback: ModelRef[]
}

const ROLE_CONFIG: Record<AgentRole, RoleConfig> = {
  // ── PRIMARY: openai/gpt-oss-120b (Groq) ─────────────────────────────────────
  // Fallback chain: MINI (same Groq account, smaller/cheaper model) ->
  // CLOUDFLARE_FALLBACK (genuinely independent second provider/account,
  // separate daily quota) -- so a day where Groq's own 200,000 TPD is
  // exhausted for BOTH its models still has real capacity left, rather
  // than failing every subsequent request for the rest of the day.
  assistant: {
    primary: DEFAULT_MODELS.PRIMARY,
    fallback: [DEFAULT_MODELS.MINI, DEFAULT_MODELS.CLOUDFLARE_FALLBACK],
  },
  writer: {
    primary: DEFAULT_MODELS.PRIMARY,
    fallback: [DEFAULT_MODELS.MINI, DEFAULT_MODELS.CLOUDFLARE_FALLBACK],
  },
  analyzer: {
    primary: DEFAULT_MODELS.PRIMARY,
    fallback: [DEFAULT_MODELS.MINI, DEFAULT_MODELS.CLOUDFLARE_FALLBACK],
  },
  brief: {
    primary: DEFAULT_MODELS.PRIMARY,
    fallback: [DEFAULT_MODELS.MINI, DEFAULT_MODELS.CLOUDFLARE_FALLBACK],
  },
  editor: {
    primary: DEFAULT_MODELS.PRIMARY,
    fallback: [DEFAULT_MODELS.MINI, DEFAULT_MODELS.CLOUDFLARE_FALLBACK],
  },
  strategy: {
    primary: DEFAULT_MODELS.PRIMARY,
    fallback: [DEFAULT_MODELS.MINI, DEFAULT_MODELS.CLOUDFLARE_FALLBACK],
  },
  parser: {
    primary: DEFAULT_MODELS.PRIMARY,
    fallback: [DEFAULT_MODELS.MINI, DEFAULT_MODELS.CLOUDFLARE_FALLBACK],
  },
  // ── PRIMARY: openai/gpt-oss-20b (Groq mini) ─────────────────────────────────
  classifier: {
    primary: DEFAULT_MODELS.MINI,
    fallback: [DEFAULT_MODELS.PRIMARY, DEFAULT_MODELS.CLOUDFLARE_FALLBACK],
  },
  summarizer: {
    primary: DEFAULT_MODELS.MINI,
    fallback: [DEFAULT_MODELS.PRIMARY, DEFAULT_MODELS.CLOUDFLARE_FALLBACK],
  },
  translator: {
    primary: DEFAULT_MODELS.MINI,
    fallback: [DEFAULT_MODELS.PRIMARY, DEFAULT_MODELS.CLOUDFLARE_FALLBACK],
  },
  background: {
    primary: DEFAULT_MODELS.MINI,
    fallback: [DEFAULT_MODELS.PRIMARY, DEFAULT_MODELS.CLOUDFLARE_FALLBACK],
  },
  metadata: {
    primary: DEFAULT_MODELS.MINI,
    fallback: [DEFAULT_MODELS.PRIMARY, DEFAULT_MODELS.CLOUDFLARE_FALLBACK],
  },
  tagger: {
    primary: DEFAULT_MODELS.MINI,
    fallback: [DEFAULT_MODELS.PRIMARY, DEFAULT_MODELS.CLOUDFLARE_FALLBACK],
  },
  preprocessor: {
    primary: DEFAULT_MODELS.MINI,
    fallback: [DEFAULT_MODELS.PRIMARY, DEFAULT_MODELS.CLOUDFLARE_FALLBACK],
  },
}

// ── Env override ──────────────────────────────────────────────────────────────
// MODEL_<ROLE>=groq:compound overrides primary for that role at runtime.
// Format: "<provider>:<model>" e.g. "groq:compound-mini" or "openrouter:gemma-31b"

function parseModelRef(raw: string): ModelRef | null {
  const [provider, ...rest] = raw.split(':')
  if (!provider || rest.length === 0) return null
  return { provider: provider as ModelRef['provider'], model: rest.join(':') }
}

function envOverride(role: AgentRole): ModelRef | null {
  const raw = process.env[`MODEL_${role.toUpperCase()}`]
  if (!raw) return null
  return parseModelRef(raw)
}

// ── Public API ────────────────────────────────────────────────────────────────

export function getModelChain(role: AgentRole): ModelRef[] {
  const override = envOverride(role)
  const config = ROLE_CONFIG[role]
  if (override) return [override, ...config.fallback]
  return [config.primary, ...config.fallback]
}
