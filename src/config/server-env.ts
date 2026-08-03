/**
 * AIscentra — Server-Only Environment Configuration
 *
 * CRITICAL ARCHITECTURAL BOUNDARY: this file must NEVER be imported by
 * any client-side code (`'use client'` components, or any module
 * transitively imported by src/lib/supabase/client.ts). Real incident,
 * confirmed live in production: when serverEnv lived in the same file
 * as the client-safe `env` export (config/env.ts), importing that
 * single shared module from client.ts caused the ENTIRE module --
 * including this file's top-level `requireEnv('SUPABASE_SERVICE_ROLE_KEY')`
 * -- to be bundled and executed in the browser. ES modules run every
 * top-level statement on load regardless of which specific export is
 * actually used elsewhere, so the server-only validation threw
 * immediately in the browser (masked earlier by a separate,
 * since-fixed NEXT_PUBLIC_SUPABASE_URL crash that always threw first).
 * Splitting server-only config into its own file, imported only by
 * genuinely server-side modules (src/lib/supabase/server.ts,
 * src/lib/openrouter/client.ts), makes this class of error
 * structurally impossible rather than merely currently-safe by
 * accident.
 *
 * CRON_SECRET and GROQ_API_KEY remain lazy (runtime-only) getters --
 * not evaluated at build time, to avoid Vercel build failures for
 * values not needed until an actual cron/AI call happens.
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

export const serverEnv = {
  SUPABASE_SERVICE_ROLE_KEY: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
  // OpenRouter — preserved for future, optional
  OPENROUTER_API_KEY: optionalEnv('OPENROUTER_API_KEY', ''),
  OPENROUTER_MODEL: optionalEnv('OPENROUTER_MODEL', ''),
  ADMIN_EMAIL: requireEnv('ADMIN_EMAIL'),
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
  if (!value)
    throw new Error('[AIscentra] CRON_SECRET is not set. Add it to Vercel Environment Variables.')
  return value
}
