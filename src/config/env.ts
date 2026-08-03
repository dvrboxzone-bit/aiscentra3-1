/**
 * AIscentra — Validated Environment Configuration
 *
 * CRON_SECRET and GROQ_API_KEY are lazy (runtime only) —
 * not evaluated at build time to prevent Vercel build failures.
 *
 * CRITICAL: NEXT_PUBLIC_* variables MUST be accessed as a literal,
 * static expression -- `process.env.NEXT_PUBLIC_X` written directly in
 * the source, never via a dynamic lookup like `process.env[key]` where
 * `key` is a runtime variable/function parameter. Next.js's build-time
 * inlining of NEXT_PUBLIC_* variables works by scanning the source code
 * for that exact literal text pattern and replacing it with the actual
 * value as a compile-time constant; it does not trace function calls
 * or otherwise determine that a generic helper called with a literal
 * string argument will resolve to the same variable at runtime. A
 * dynamic lookup is invisible to that static analysis, so the value
 * silently becomes `undefined` in the browser bundle regardless of how
 * correctly the variable is configured in Vercel.
 *
 * This was a REAL incident, not a theoretical concern: with the
 * previous `requireEnv('NEXT_PUBLIC_SUPABASE_URL')` (a dynamic
 * `process.env[key]` lookup inside a shared helper), no combination of
 * fixing the Vercel Project env var's value, forcing a fresh
 * (non-cached) build, or switching to Vercel's documented
 * pull+build+prebuilt deploy sequence could ever have worked -- the
 * variable was never going to be inlined for the client bundle with
 * that code shape, independent of any deployment-pipeline correctness.
 * Confirmed as the actual root cause of a client-side crash
 * ("[AIscentra] Missing required environment variable:
 * NEXT_PUBLIC_SUPABASE_URL") that persisted across four separate,
 * otherwise-correct release-engineering fixes.
 *
 * requireEnv()/optionalEnv() below remain fine to use for SERVER-ONLY
 * variables (serverEnv, getGroqApiKey, getCronSecret) -- those never
 * need build-time client-bundle inlining at all; a real Node process
 * reads process.env dynamically at runtime on the server without this
 * restriction. The restriction applies specifically to values exposed
 * to the browser.
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

function requireStaticEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `[AIscentra] Missing required environment variable: ${name}\n` +
        `Copy .env.example to .env.local and fill in the value.`,
    )
  }
  return value
}

// ── Public ────────────────────────────────────────────────────────────────────
// Each NEXT_PUBLIC_* value below is read via a LITERAL, STATIC
// `process.env.NEXT_PUBLIC_X` expression -- required for Next.js to
// correctly inline it into the client bundle. Do not refactor these
// into a dynamic-key helper call; see the module docstring above.
export const env = {
  SUPABASE_URL: requireStaticEnv('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL),
  SUPABASE_ANON_KEY: requireStaticEnv(
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  ),
  APP_URL: process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
  NODE_ENV: optionalEnv('NODE_ENV', 'development'),
  IS_PROD: process.env.NODE_ENV === 'production',
  IS_DEV: process.env.NODE_ENV === 'development',
} as const

// ── Server-only ───────────────────────────────────────────────────────────────
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
