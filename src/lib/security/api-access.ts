/**
 * AIscentra — Centralized Server-Only API Access Guard
 *
 * Phase 1A: Emergency API Containment.
 *
 * This module is the SINGLE place that decides whether a request to a
 * cost-sensitive or privileged route is allowed to proceed. It must never
 * be bypassed by copying ad-hoc secret checks into individual route
 * handlers.
 *
 * Self-contained by design: reads process.env directly for the seven
 * variables it needs (INTERNAL_API_SECRET, ADMIN_API_SECRET,
 * ENABLE_INTERNAL_AGENT_API, ENABLE_ENGINE_SIMULATION,
 * PUBLIC_ASSISTANT_ACCESS_MODE, VERCEL_ENV, NODE_ENV). It deliberately
 * does NOT import src/config/env.ts — that module evaluates an eager,
 * top-level `export const env = { SUPABASE_URL: requireEnv(...), ... }`
 * block that throws immediately at import time if NEXT_PUBLIC_SUPABASE_URL
 * is missing, regardless of which export is actually used. Importing it
 * here would make this guard module's mere presence in an import graph
 * capable of crashing a request before the guard logic itself ever runs —
 * exactly the kind of privileged-import-before-guard problem this module
 * exists to prevent. Refactoring env.ts's eager/lazy split is explicitly
 * out of scope for Phase 1A (separate architectural debt).
 *
 * Three classifications, each with its own guard function:
 *   - internal          : /api/agent            (ENABLE_INTERNAL_AGENT_API + INTERNAL_API_SECRET)
 *   - admin              : /api/admin/*           (ENABLE_ENGINE_SIMULATION + ADMIN_API_SECRET)
 *   - disabled-public-ai : /api/assistant         (PUBLIC_ASSISTANT_ACCESS_MODE)
 *
 * Fail-closed by design: any missing, malformed, or ambiguous configuration
 * value results in denial, never in an implicit allow. This module never
 * uses CRON_SECRET for internal or admin routes — that secret is reserved
 * exclusively for /api/cron/* handlers, per existing project convention,
 * and mixing the two would blur an important trust boundary.
 *
 * No secret value is ever included in a thrown error, a log line, or an
 * HTTP response body. Comparison of the caller-supplied token against the
 * configured secret uses Node's `crypto.timingSafeEqual` (constant-time),
 * not `===`, to avoid leaking secret content through response-timing
 * side channels.
 */
import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'

// ── Standardized safe responses ────────────────────────────────────────────────
// Every response body here is a fixed, generic string. None of these ever
// include the underlying reason in enough detail to help an attacker
// distinguish "wrong secret" from "feature disabled" from "misconfigured
// server" — the caller-facing behavior is deliberately uninformative.

export function methodNotAllowedResponse(allow: string): NextResponse {
  return NextResponse.json(
    { error: 'Method Not Allowed' },
    { status: 405, headers: { Allow: allow } },
  )
}

function unauthorizedResponse(): NextResponse {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

function forbiddenResponse(): NextResponse {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}

function notFoundResponse(): NextResponse {
  return NextResponse.json({ error: 'Not Found' }, { status: 404 })
}

function serviceUnavailableResponse(): NextResponse {
  return NextResponse.json({ error: 'Service temporarily unavailable' }, { status: 503 })
}

// ── Result type ────────────────────────────────────────────────────────────────

export interface GuardAllowed {
  allowed: true
}

export interface GuardDenied {
  allowed: false
  response: NextResponse
  /** Sanitized, non-secret reason for server-side logging only (never sent to the client). */
  internalReason: string
}

export type GuardResult = GuardAllowed | GuardDenied

// ── Bearer token extraction ────────────────────────────────────────────────────

function extractBearerToken(request: Request): string | null {
  const header = request.headers.get('authorization')
  if (!header) return null
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  if (!match) return null
  const token = match[1]?.trim()
  return token && token.length > 0 ? token : null
}

// ── Constant-time secret comparison ────────────────────────────────────────────
// Rejects immediately (without a timing-unsafe early return based on content)
// when lengths differ, since timingSafeEqual throws on mismatched buffer
// lengths rather than comparing them. A length mismatch is not considered a
// meaningful secret-content leak here: the expected secret length is not
// itself sensitive information, and the alternative (padding to a fixed
// length before every comparison) would add complexity without a
// corresponding security benefit for this threat model.
function constantTimeEquals(candidate: string, expected: string): boolean {
  const candidateBuf = Buffer.from(candidate, 'utf8')
  const expectedBuf = Buffer.from(expected, 'utf8')
  if (candidateBuf.length !== expectedBuf.length) return false
  return timingSafeEqual(candidateBuf, expectedBuf)
}

// ── Raw env readers (private to this module — single point of interpretation) ──

function readEnableFlag(name: string): boolean {
  return process.env[name] === 'true'
}

// A secret must actually be present, non-whitespace, not the documented
// .env.example placeholder value, and at least 32 characters — anything
// less is treated as "not configured" (fail-closed), never as a weak-but-
// present secret. This prevents an .env.example placeholder value or an
// empty/whitespace string from ever being accepted as a real secret.
const MIN_SECRET_LENGTH = 32
const KNOWN_PLACEHOLDER_VALUES = new Set(['your-random-secret-here'])

function readSecret(name: string): string | null {
  const raw = process.env[name]
  if (raw === undefined) return null

  const trimmed = raw.trim()
  if (trimmed.length === 0) return null
  if (KNOWN_PLACEHOLDER_VALUES.has(trimmed)) return null
  if (trimmed.length < MIN_SECRET_LENGTH) return null

  // Intentionally return the ORIGINAL (untrimmed) value for comparison —
  // if an operator's real secret happens to have meaningful leading/
  // trailing whitespace (unusual, but not this module's business to
  // silently correct), constant-time comparison must be against the exact
  // configured value, not a normalized one. Trimming above is only used to
  // classify emptiness/placeholder/length, not to alter what is compared.
  return raw
}

// ── Internal guard: /api/agent ────────────────────────────────────────────────

export function checkInternalAccess(request: Request): GuardResult {
  const enabled = readEnableFlag('ENABLE_INTERNAL_AGENT_API')
  const secret = readSecret('INTERNAL_API_SECRET')

  // Fail-closed: if the feature is not explicitly enabled, or the secret is
  // not configured at all, deny unconditionally — never fall through to a
  // permissive default. Returns 404 rather than 401/403 so a misconfigured
  // or intentionally-disabled route does not reveal its own existence.
  if (!enabled || !secret) {
    return {
      allowed: false,
      response: notFoundResponse(),
      internalReason: !enabled
        ? 'internal access denied: ENABLE_INTERNAL_AGENT_API is not "true"'
        : 'internal access denied: INTERNAL_API_SECRET is not configured',
    }
  }

  const token = extractBearerToken(request)
  if (!token) {
    return {
      allowed: false,
      response: unauthorizedResponse(),
      internalReason: 'internal access denied: missing Authorization header',
    }
  }

  if (!constantTimeEquals(token, secret)) {
    return {
      allowed: false,
      response: forbiddenResponse(),
      internalReason: 'internal access denied: invalid bearer token',
    }
  }

  return { allowed: true }
}

// ── Admin guard: /api/admin/* ──────────────────────────────────────────────────

export function checkAdminAccess(request: Request): GuardResult {
  const enabled = readEnableFlag('ENABLE_ENGINE_SIMULATION')
  const secret = readSecret('ADMIN_API_SECRET')

  if (!enabled || !secret) {
    return {
      allowed: false,
      response: notFoundResponse(),
      internalReason: !enabled
        ? 'admin access denied: ENABLE_ENGINE_SIMULATION is not "true"'
        : 'admin access denied: ADMIN_API_SECRET is not configured',
    }
  }

  const token = extractBearerToken(request)
  if (!token) {
    return {
      allowed: false,
      response: unauthorizedResponse(),
      internalReason: 'admin access denied: missing Authorization header',
    }
  }

  if (!constantTimeEquals(token, secret)) {
    return {
      allowed: false,
      response: forbiddenResponse(),
      internalReason: 'admin access denied: invalid bearer token',
    }
  }

  return { allowed: true }
}

// ── Public Assistant guard: /api/assistant ────────────────────────────────────
// Not bearer-secured — this is a coarse kill switch, not a per-caller auth
// mechanism. Full authenticated-session support is explicitly out of scope
// for this containment phase (see PR description).

export type PublicAssistantAccessMode = 'disabled' | 'preview-only'

function resolvePublicAssistantAccessMode(): PublicAssistantAccessMode {
  const raw = process.env['PUBLIC_ASSISTANT_ACCESS_MODE']
  // Fail-closed: any value other than the two explicitly recognized ones —
  // including undefined, empty string, a typo, or an unexpected value —
  // resolves to 'disabled'. There is no default-allow path.
  return raw === 'preview-only' ? 'preview-only' : 'disabled'
}

function isKnownSafeNonProductionEnvironment(): boolean {
  // Vercel sets VERCEL_ENV to exactly one of: 'production' | 'preview' | 'development'.
  //
  // This is an ALLOW-LIST, not a deny-list: only the two explicitly
  // recognized non-production values are treated as safe. Any other
  // defined VERCEL_ENV value — a typo ('prod'), an unrelated convention
  // ('staging'), or an empty string — is NOT recognized and fails closed
  // exactly as if it were production. The previous implementation was a
  // deny-list (`=== 'production'` only) and therefore silently treated
  // any unrecognized value as safe — this was the actual vulnerability
  // being fixed here.
  const vercelEnv = process.env['VERCEL_ENV']

  if (vercelEnv !== undefined) {
    return vercelEnv === 'preview' || vercelEnv === 'development'
  }

  // VERCEL_ENV is not set at all — e.g. running outside Vercel entirely
  // (local development, this test suite, or a non-Vercel host). Fall back
  // to NODE_ENV: anything other than the literal 'production' is treated
  // as safe (matches existing local-development conventions elsewhere in
  // this codebase, e.g. src/config/env.ts's IS_DEV/IS_PROD checks).
  return process.env['NODE_ENV'] !== 'production'
}

export function checkPublicAssistantAccess(): GuardResult {
  const mode = resolvePublicAssistantAccessMode()

  if (mode === 'disabled') {
    return {
      allowed: false,
      response: serviceUnavailableResponse(),
      internalReason: 'public assistant access denied: PUBLIC_ASSISTANT_ACCESS_MODE is disabled',
    }
  }

  // mode === 'preview-only' from here on. Even if an environment variable
  // claims 'preview-only', this is only honored in a recognized non-
  // production environment — an unrecognized or production environment
  // always resolves to disabled regardless of misconfiguration, per the
  // explicit fail-closed requirement that "in production значение всегда
  // должно фактически давать disabled, даже если environment настроен
  // ошибочно".
  if (!isKnownSafeNonProductionEnvironment()) {
    return {
      allowed: false,
      response: serviceUnavailableResponse(),
      internalReason:
        'public assistant access denied: preview-only mode is not honored outside a recognized preview/development environment',
    }
  }

  return { allowed: true }
}
