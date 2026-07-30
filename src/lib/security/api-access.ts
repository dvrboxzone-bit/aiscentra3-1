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

function readSecret(name: string): string | null {
  const value = process.env[name]
  return value && value.length > 0 ? value : null
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

function isProductionEnvironment(): boolean {
  // Vercel sets VERCEL_ENV to 'production' | 'preview' | 'development'.
  // Fall back to NODE_ENV === 'production' for non-Vercel environments
  // (e.g. a production-like process started outside Vercel's platform).
  // Fail-closed direction: if EITHER signal says production, treat it as
  // production — never require both to agree before restricting access.
  if (process.env['VERCEL_ENV'] === 'production') return true
  if (process.env['VERCEL_ENV'] === undefined && process.env['NODE_ENV'] === 'production')
    return true
  return false
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
  // claims 'preview-only', this is only honored outside production —
  // production always resolves to disabled regardless of misconfiguration,
  // per the explicit fail-closed requirement that "in production значение
  // всегда должно фактически давать disabled, даже если environment
  // настроен ошибочно".
  if (isProductionEnvironment()) {
    return {
      allowed: false,
      response: serviceUnavailableResponse(),
      internalReason:
        'public assistant access denied: preview-only mode is not honored in production',
    }
  }

  return { allowed: true }
}
