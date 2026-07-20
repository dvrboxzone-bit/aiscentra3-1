/**
 * AIscentra — Validated Environment Configuration
 *
 * CRON_SECRET and GROQ_API_KEY are lazy (runtime only) —
 * not evaluated at build time to prevent Vercel build failures.
 */

function requireEnv(key: string): string {
  const value = process.env[key]
  if (!value) {
    throw new Error(
      `[AIscentra] Missing required environment variable: ${key}\n` +
      `Copy .env.example to .env.local and fill in the value.`,
    )
  }
  return value
}

function optionalEnv(key: string, fallback: string): string {
  return process.env[key] ?? fallback
}

// ── Public ────────────────────────────────────────────────────────────────────
export const env = {
  SUPABASE_URL:      requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
  SUPABASE_ANON_KEY: requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  APP_URL:  optionalEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000'),
  NODE_ENV: optionalEnv('NODE_ENV', 'development'),
  IS_PROD:  process.env.NODE_ENV === 'production',
  IS_DEV:   process.env.NODE_ENV === 'development',
} as const

// ── Server-only ───────────────────────────────────────────────────────────────
export const serverEnv = {
  SUPABASE_SERVICE_ROLE_KEY: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
  // OpenRouter — preserved for future, optional
  OPENROUTER_API_KEY: optionalEnv('OPENROUTER_API_KEY', ''),
  OPENROUTER_MODEL:   optionalEnv('OPENROUTER_MODEL', ''),
  ADMIN_EMAIL:        requireEnv('ADMIN_EMAIL'),
} as const

/**
 * GROQ_API_KEY — lazy runtime getter.
 * Not evaluated at build time. Set in Vercel Environment Variables.
 */
export function getGroqApiKey(): string {
  const value = process.env['GROQ_API_KEY']
  if (!value) throw new Error('[AIscentra] GROQ_API_KEY is not set in environment variables.')
  return value
}

/**
 * CRON_SECRET — lazy runtime getter.
 * Not evaluated at build time. Set in Vercel Environment Variables.
 */
export function getCronSecret(): string {
  const value = process.env['CRON_SECRET']
  if (!value) throw new Error(
    '[AIscentra] CRON_SECRET is not set. Add it to Vercel Environment Variables.'
  )
  return value
}
