/**
 * AIscentra — Phase 1A: API Access Guard Tests
 *
 * Real, deterministic tests using Node's built-in test runner (node:test).
 * No mocking framework. Tests the actual exported guard functions from
 * src/lib/security/api-access.ts directly — no network, no database, no
 * AI provider calls anywhere in this file.
 *
 * All secrets used here are >=32 characters, matching the production
 * minimum-length requirement enforced by readSecret().
 *
 * Environment variables are saved and restored around every test to avoid
 * cross-test contamination (tests run sequentially within a single
 * process via node --test).
 */
import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

import { checkInternalAccess, checkAdminAccess, checkPublicAssistantAccess } from '../api-access'

const VALID_SECRET_A = 'a'.repeat(32)
const VALID_SECRET_B = 'b'.repeat(32)
const VALID_SECRET_C = 'c'.repeat(40)

const ENV_KEYS = [
  'ENABLE_INTERNAL_AGENT_API',
  'INTERNAL_API_SECRET',
  'ENABLE_ENGINE_SIMULATION',
  'ADMIN_API_SECRET',
  'PUBLIC_ASSISTANT_ACCESS_MODE',
  'VERCEL_ENV',
  'NODE_ENV',
] as const

let savedEnv: Record<string, string | undefined> = {}

beforeEach(() => {
  savedEnv = {}
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key]
    delete process.env[key]
  }
})

afterEach(() => {
  const mutableEnv = process.env as Record<string, string | undefined>
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) {
      delete mutableEnv[key]
    } else {
      mutableEnv[key] = savedEnv[key]
    }
  }
})

function makeRequest(authHeader?: string): Request {
  const headers: Record<string, string> = {}
  if (authHeader !== undefined) headers['authorization'] = authHeader
  return new Request('https://example.invalid/api/test', { headers })
}

// ── checkInternalAccess (/api/agent) ────────────────────────────────────────────

describe('checkInternalAccess — fail-closed behavior', () => {
  test('denies with 404 when INTERNAL_API_SECRET is entirely missing (even with a bearer token supplied)', () => {
    process.env['ENABLE_INTERNAL_AGENT_API'] = 'true'
    const result = checkInternalAccess(makeRequest('Bearer whatever'))
    assert.equal(result.allowed, false)
    if (!result.allowed) assert.equal(result.response.status, 404)
  })

  test('denies with 404 when ENABLE_INTERNAL_AGENT_API is not the literal string "true"', () => {
    process.env['ENABLE_INTERNAL_AGENT_API'] = 'yes'
    process.env['INTERNAL_API_SECRET'] = VALID_SECRET_A
    const result = checkInternalAccess(makeRequest(`Bearer ${VALID_SECRET_A}`))
    assert.equal(result.allowed, false)
    if (!result.allowed) assert.equal(result.response.status, 404)
  })

  test('denies with 404 when ENABLE_INTERNAL_AGENT_API is unset entirely', () => {
    process.env['INTERNAL_API_SECRET'] = VALID_SECRET_A
    const result = checkInternalAccess(makeRequest(`Bearer ${VALID_SECRET_A}`))
    assert.equal(result.allowed, false)
    if (!result.allowed) assert.equal(result.response.status, 404)
  })

  test('denies with 401 when enabled and configured, but no Authorization header is present', () => {
    process.env['ENABLE_INTERNAL_AGENT_API'] = 'true'
    process.env['INTERNAL_API_SECRET'] = VALID_SECRET_A
    const result = checkInternalAccess(makeRequest())
    assert.equal(result.allowed, false)
    if (!result.allowed) assert.equal(result.response.status, 401)
  })

  test('denies with 403 when enabled and configured, but the bearer token is wrong', () => {
    process.env['ENABLE_INTERNAL_AGENT_API'] = 'true'
    process.env['INTERNAL_API_SECRET'] = VALID_SECRET_A
    const result = checkInternalAccess(makeRequest(`Bearer ${'z'.repeat(32)}`))
    assert.equal(result.allowed, false)
    if (!result.allowed) assert.equal(result.response.status, 403)
  })

  test('denies with 403 when the bearer token has a different length than the configured secret', () => {
    process.env['ENABLE_INTERNAL_AGENT_API'] = 'true'
    process.env['INTERNAL_API_SECRET'] = VALID_SECRET_A
    const result = checkInternalAccess(makeRequest('Bearer short'))
    assert.equal(result.allowed, false)
    if (!result.allowed) assert.equal(result.response.status, 403)
  })

  test('allows when enabled, configured, and the exact correct bearer token is supplied', () => {
    process.env['ENABLE_INTERNAL_AGENT_API'] = 'true'
    process.env['INTERNAL_API_SECRET'] = VALID_SECRET_A
    const result = checkInternalAccess(makeRequest(`Bearer ${VALID_SECRET_A}`))
    assert.equal(result.allowed, true)
  })

  test('is case-insensitive on the "Bearer" scheme keyword but not on the secret value itself', () => {
    process.env['ENABLE_INTERNAL_AGENT_API'] = 'true'
    process.env['INTERNAL_API_SECRET'] = VALID_SECRET_A
    const wrongCase = checkInternalAccess(makeRequest(`bearer ${VALID_SECRET_A.toUpperCase()}`))
    assert.equal(wrongCase.allowed, false, 'the secret value itself must remain case-sensitive')
    const rightCase = checkInternalAccess(makeRequest(`bearer ${VALID_SECRET_A}`))
    assert.equal(
      rightCase.allowed,
      true,
      'the "Bearer"/"bearer" scheme keyword itself may be case-insensitive per RFC 6750 convention',
    )
  })
})

// ── Secret configuration validation (empty / whitespace / placeholder / short) ──

describe('secret configuration validation — fail-closed on weak/placeholder values', () => {
  test('denies with 404 when INTERNAL_API_SECRET is an empty string', () => {
    process.env['ENABLE_INTERNAL_AGENT_API'] = 'true'
    process.env['INTERNAL_API_SECRET'] = ''
    const result = checkInternalAccess(makeRequest('Bearer whatever'))
    assert.equal(result.allowed, false)
    if (!result.allowed) assert.equal(result.response.status, 404)
  })

  test('denies with 404 when INTERNAL_API_SECRET is whitespace-only', () => {
    process.env['ENABLE_INTERNAL_AGENT_API'] = 'true'
    process.env['INTERNAL_API_SECRET'] = '   \t   '
    const result = checkInternalAccess(makeRequest('Bearer whatever'))
    assert.equal(result.allowed, false)
    if (!result.allowed) assert.equal(result.response.status, 404)
  })

  test('denies with 404 when INTERNAL_API_SECRET is the documented .env.example placeholder', () => {
    process.env['ENABLE_INTERNAL_AGENT_API'] = 'true'
    process.env['INTERNAL_API_SECRET'] = 'your-random-secret-here'
    const result = checkInternalAccess(makeRequest('Bearer your-random-secret-here'))
    assert.equal(result.allowed, false)
    if (!result.allowed) assert.equal(result.response.status, 404)
  })

  test('denies with 404 when INTERNAL_API_SECRET is shorter than the 32-character minimum', () => {
    process.env['ENABLE_INTERNAL_AGENT_API'] = 'true'
    process.env['INTERNAL_API_SECRET'] = 'short-secret-31-chars-long-xx'
    const result = checkInternalAccess(makeRequest('Bearer short-secret-31-chars-long-xx'))
    assert.equal(result.allowed, false)
    if (!result.allowed) assert.equal(result.response.status, 404)
  })

  test('allows when INTERNAL_API_SECRET is exactly 32 characters (the minimum)', () => {
    process.env['ENABLE_INTERNAL_AGENT_API'] = 'true'
    process.env['INTERNAL_API_SECRET'] = VALID_SECRET_A
    assert.equal(VALID_SECRET_A.length, 32)
    const result = checkInternalAccess(makeRequest(`Bearer ${VALID_SECRET_A}`))
    assert.equal(result.allowed, true)
  })
})

// ── checkAdminAccess (/api/admin/simulate-engine-v2) ────────────────────────────

describe('checkAdminAccess — fail-closed behavior', () => {
  test('denies with 404 when ADMIN_API_SECRET is missing', () => {
    process.env['ENABLE_ENGINE_SIMULATION'] = 'true'
    const result = checkAdminAccess(makeRequest('Bearer whatever'))
    assert.equal(result.allowed, false)
    if (!result.allowed) assert.equal(result.response.status, 404)
  })

  test('denies with 404 when ENABLE_ENGINE_SIMULATION is not "true"', () => {
    process.env['ADMIN_API_SECRET'] = VALID_SECRET_B
    const result = checkAdminAccess(makeRequest(`Bearer ${VALID_SECRET_B}`))
    assert.equal(result.allowed, false)
    if (!result.allowed) assert.equal(result.response.status, 404)
  })

  test('denies with 401 when no Authorization header is present', () => {
    process.env['ENABLE_ENGINE_SIMULATION'] = 'true'
    process.env['ADMIN_API_SECRET'] = VALID_SECRET_B
    const result = checkAdminAccess(makeRequest())
    assert.equal(result.allowed, false)
    if (!result.allowed) assert.equal(result.response.status, 401)
  })

  test('denies with 403 when the bearer token is wrong', () => {
    process.env['ENABLE_ENGINE_SIMULATION'] = 'true'
    process.env['ADMIN_API_SECRET'] = VALID_SECRET_B
    const result = checkAdminAccess(makeRequest(`Bearer ${'z'.repeat(32)}`))
    assert.equal(result.allowed, false)
    if (!result.allowed) assert.equal(result.response.status, 403)
  })

  test('allows when enabled, configured, and the exact correct bearer token is supplied', () => {
    process.env['ENABLE_ENGINE_SIMULATION'] = 'true'
    process.env['ADMIN_API_SECRET'] = VALID_SECRET_B
    const result = checkAdminAccess(makeRequest(`Bearer ${VALID_SECRET_B}`))
    assert.equal(result.allowed, true)
  })

  test('INTERNAL_API_SECRET does not satisfy the admin guard, and ADMIN_API_SECRET does not satisfy the internal guard (separate trust boundaries)', () => {
    process.env['ENABLE_INTERNAL_AGENT_API'] = 'true'
    process.env['INTERNAL_API_SECRET'] = VALID_SECRET_A
    process.env['ENABLE_ENGINE_SIMULATION'] = 'true'
    process.env['ADMIN_API_SECRET'] = VALID_SECRET_B

    const adminTokenAgainstInternalGuard = checkInternalAccess(
      makeRequest(`Bearer ${VALID_SECRET_B}`),
    )
    assert.equal(
      adminTokenAgainstInternalGuard.allowed,
      false,
      'ADMIN_API_SECRET must not grant internal access',
    )

    const internalTokenAgainstAdminGuard = checkAdminAccess(makeRequest(`Bearer ${VALID_SECRET_A}`))
    assert.equal(
      internalTokenAgainstAdminGuard.allowed,
      false,
      'INTERNAL_API_SECRET must not grant admin access',
    )
  })
})

// ── checkPublicAssistantAccess (/api/assistant) — production environment fail-closed ─

describe('checkPublicAssistantAccess — fail-closed behavior, strict environment interpretation', () => {
  test('denies with 503 when PUBLIC_ASSISTANT_ACCESS_MODE is unset', () => {
    const result = checkPublicAssistantAccess()
    assert.equal(result.allowed, false)
    if (!result.allowed) assert.equal(result.response.status, 503)
  })

  test('denies with 503 when PUBLIC_ASSISTANT_ACCESS_MODE is an unrecognized value (e.g. a typo)', () => {
    process.env['PUBLIC_ASSISTANT_ACCESS_MODE'] = 'enabled'
    const result = checkPublicAssistantAccess()
    assert.equal(result.allowed, false)
    if (!result.allowed) assert.equal(result.response.status, 503)
  })

  test('denies with 503 when explicitly set to "disabled"', () => {
    process.env['PUBLIC_ASSISTANT_ACCESS_MODE'] = 'disabled'
    const result = checkPublicAssistantAccess()
    assert.equal(result.allowed, false)
    if (!result.allowed) assert.equal(result.response.status, 503)
  })

  // ── 8 required environment scenarios ──────────────────────────────────────────

  test('1. VERCEL_ENV=production, mode=preview-only → deny', () => {
    process.env['PUBLIC_ASSISTANT_ACCESS_MODE'] = 'preview-only'
    process.env['VERCEL_ENV'] = 'production'
    const result = checkPublicAssistantAccess()
    assert.equal(result.allowed, false)
    if (!result.allowed) assert.equal(result.response.status, 503)
  })

  test('2. VERCEL_ENV absent, NODE_ENV=production → deny', () => {
    process.env['PUBLIC_ASSISTANT_ACCESS_MODE'] = 'preview-only'
    ;(process.env as Record<string, string | undefined>)['NODE_ENV'] = 'production'
    // VERCEL_ENV intentionally left unset
    const result = checkPublicAssistantAccess()
    assert.equal(result.allowed, false)
    if (!result.allowed) assert.equal(result.response.status, 503)
  })

  test('3. VERCEL_ENV=preview, NODE_ENV=production → allow (normal Vercel Preview environment)', () => {
    process.env['PUBLIC_ASSISTANT_ACCESS_MODE'] = 'preview-only'
    process.env['VERCEL_ENV'] = 'preview'
    ;(process.env as Record<string, string | undefined>)['NODE_ENV'] = 'production' // Vercel sets NODE_ENV=production even for Preview builds
    const result = checkPublicAssistantAccess()
    assert.equal(
      result.allowed,
      true,
      'VERCEL_ENV=preview must take priority over NODE_ENV=production, since Vercel Preview builds set NODE_ENV=production by default',
    )
  })

  test('4. VERCEL_ENV=development → allow', () => {
    process.env['PUBLIC_ASSISTANT_ACCESS_MODE'] = 'preview-only'
    process.env['VERCEL_ENV'] = 'development'
    const result = checkPublicAssistantAccess()
    assert.equal(result.allowed, true)
  })

  test('5. VERCEL_ENV=prod (typo/unrecognized) → deny', () => {
    process.env['PUBLIC_ASSISTANT_ACCESS_MODE'] = 'preview-only'
    process.env['VERCEL_ENV'] = 'prod'
    const result = checkPublicAssistantAccess()
    assert.equal(
      result.allowed,
      false,
      'an unrecognized VERCEL_ENV value must fail closed, not default-allow',
    )
    if (!result.allowed) assert.equal(result.response.status, 503)
  })

  test('6. VERCEL_ENV=staging (unrecognized) → deny', () => {
    process.env['PUBLIC_ASSISTANT_ACCESS_MODE'] = 'preview-only'
    process.env['VERCEL_ENV'] = 'staging'
    const result = checkPublicAssistantAccess()
    assert.equal(result.allowed, false)
    if (!result.allowed) assert.equal(result.response.status, 503)
  })

  test("7. VERCEL_ENV='' (defined but empty) → deny", () => {
    process.env['PUBLIC_ASSISTANT_ACCESS_MODE'] = 'preview-only'
    process.env['VERCEL_ENV'] = ''
    const result = checkPublicAssistantAccess()
    assert.equal(
      result.allowed,
      false,
      'an empty-but-defined VERCEL_ENV must fail closed, not be treated the same as unset',
    )
    if (!result.allowed) assert.equal(result.response.status, 503)
  })

  test('8. an unknown VERCEL_ENV value cannot enable Assistant even with mode=preview-only', () => {
    process.env['PUBLIC_ASSISTANT_ACCESS_MODE'] = 'preview-only'
    process.env['VERCEL_ENV'] = 'some-totally-unknown-value'
    const result = checkPublicAssistantAccess()
    assert.equal(result.allowed, false)
  })

  test('allows "preview-only" mode outside production (VERCEL_ENV unset, i.e. local development)', () => {
    process.env['PUBLIC_ASSISTANT_ACCESS_MODE'] = 'preview-only'
    const result = checkPublicAssistantAccess()
    assert.equal(result.allowed, true)
  })

  test('allows "preview-only" mode when VERCEL_ENV=preview', () => {
    process.env['PUBLIC_ASSISTANT_ACCESS_MODE'] = 'preview-only'
    process.env['VERCEL_ENV'] = 'preview'
    const result = checkPublicAssistantAccess()
    assert.equal(result.allowed, true)
  })

  test('CRITICAL: forces disabled in production (VERCEL_ENV=production) even when PUBLIC_ASSISTANT_ACCESS_MODE=preview-only', () => {
    process.env['PUBLIC_ASSISTANT_ACCESS_MODE'] = 'preview-only'
    process.env['VERCEL_ENV'] = 'production'
    const result = checkPublicAssistantAccess()
    assert.equal(
      result.allowed,
      false,
      'production must never honor preview-only, regardless of configuration',
    )
    if (!result.allowed) assert.equal(result.response.status, 503)
  })
})

// ── Secret leakage check ────────────────────────────────────────────────────────

describe('secret leakage', () => {
  test('a denial response body never contains the configured secret value', async () => {
    process.env['ENABLE_INTERNAL_AGENT_API'] = 'true'
    process.env['INTERNAL_API_SECRET'] = VALID_SECRET_C
    const result = checkInternalAccess(makeRequest(`Bearer ${'z'.repeat(40)}`))
    assert.equal(result.allowed, false)
    if (!result.allowed) {
      const bodyText = await result.response.clone().text()
      assert.equal(
        bodyText.includes(VALID_SECRET_C),
        false,
        'response body must never contain the configured secret',
      )
      assert.equal(
        result.internalReason.includes(VALID_SECRET_C),
        false,
        'internal log reason must never contain the configured secret either',
      )
    }
  })
})
