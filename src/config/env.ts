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

/**
 * Safe, non-secret-leaking diagnostic summary of a string value:
 * length, first/last 4 characters, and the char code of the first
 * character (catches invisible characters -- leading whitespace,
 * zero-width spaces, BOM, smart quotes copy-pasted from a browser --
 * that would otherwise be indistinguishable from a correct value in
 * any log or screenshot, since Vercel masks the full value in its own
 * dashboard and a masked value looks identical whether it starts with
 * an invisible corrupt character or not).
 */
function describeForDiagnostics(value: string): string {
  const start = value.slice(0, 4)
  const end = value.length > 8 ? value.slice(-4) : ''
  const firstCharCode = value.length > 0 ? value.charCodeAt(0) : 0
  return `length=${value.length} starts="${start}" ends="${end}" firstCharCode=${firstCharCode}`
}

/**
 * Requires a NEXT_PUBLIC_* value AND validates it is actually a
 * well-formed URL before returning it -- rather than letting a
 * malformed-but-non-empty value silently pass through requireStaticEnv
 * and crash much later, deep inside @supabase/supabase-js's own
 * SupabaseClient constructor (`new URL(this.authUrl)`, unconditional,
 * for every client construction) with an opaque, Next.js-redacted
 * `input: '[SENSITIVE]/auth/v1'` and no indication of what was actually
 * wrong with the value.
 *
 * This was a REAL, repeated incident: the exact same "TypeError:
 * Invalid URL" / "/auth/v1" build failure recurred on /observatory's
 * static generation even after the Project's NEXT_PUBLIC_SUPABASE_URL
 * value was deleted and re-added from scratch in the Vercel dashboard --
 * with no way to see the actual masked value on either side (Vercel
 * dashboard masks it; so does Next.js's own build-log redaction of
 * anything it heuristically flags as sensitive). This function makes
 * the failure diagnosable going forward: if the value is present but
 * not `new URL()`-parseable, it throws immediately, at the actual
 * source of the problem, with a safe (non-secret) description of the
 * value's shape instead of letting a downstream library's opaque
 * failure be the only signal.
 */
function requireStaticUrlEnv(name: string, value: string | undefined): string {
  const resolved = requireStaticEnv(name, value)
  try {
    new URL(resolved)
  } catch {
    throw new Error(
      `[AIscentra] ${name} is set but is not a valid URL (${describeForDiagnostics(resolved)}). ` +
        `Check this value in Vercel Project Settings -- it must start with https:// and contain ` +
        `no extra whitespace, quotes, or invisible characters.`,
    )
  }
  return resolved
}

// ── Public ────────────────────────────────────────────────────────────────────
// Each NEXT_PUBLIC_* value below is read via a LITERAL, STATIC
// `process.env.NEXT_PUBLIC_X` expression -- required for Next.js to
// correctly inline it into the client bundle. Do not refactor these
// into a dynamic-key helper call; see the module docstring above.
export const env = {
  SUPABASE_URL: requireStaticUrlEnv(
    'NEXT_PUBLIC_SUPABASE_URL',
    process.env.NEXT_PUBLIC_SUPABASE_URL,
  ),
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
