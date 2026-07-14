/**
 * AIscentra — Validated Environment Configuration
 *
 * The application will throw at startup if any required variable is missing.
 * This prevents silent failures where missing config causes runtime errors
 * in production that are hard to trace.
 *
 * Pattern: validate once at module load, export typed constants.
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

// ── Public (safe to expose to browser) ──────────────────────────────────────
export const env = {
  // Supabase client-side config
  SUPABASE_URL:      requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
  SUPABASE_ANON_KEY: requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),

  // Application
  APP_URL:     optionalEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000'),
  NODE_ENV:    optionalEnv('NODE_ENV', 'development'),
  IS_PROD:     process.env.NODE_ENV === 'production',
  IS_DEV:      process.env.NODE_ENV === 'development',
} as const

// ── Server-only (never expose to browser) ───────────────────────────────────
// These are accessed separately to prevent accidental client-side bundling.
// Import from '@/config/env.server' in server components and API routes only.
export const serverEnv = {
  SUPABASE_SERVICE_ROLE_KEY: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
  OPENROUTER_API_KEY:        requireEnv('OPENROUTER_API_KEY'),
  OPENROUTER_MODEL:          optionalEnv('OPENROUTER_MODEL', 'anthropic/claude-3-haiku'),
  ADMIN_EMAIL:               requireEnv('ADMIN_EMAIL'),
} as const
