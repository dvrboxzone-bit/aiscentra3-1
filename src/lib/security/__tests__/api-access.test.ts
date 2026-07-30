/**
 * AIscentra — Phase 1A: API Access Guard Tests
 *
 * Real, deterministic tests using Node's built-in test runner (node:test).
 * No mocking framework. Tests the actual exported guard functions from
 * src/lib/security/api-access.ts directly — no network, no database, no
 * AI provider calls anywhere in this file.
 *
 * Environment variables are saved and restored around every test to avoid
 * cross-test contamination (tests run sequentially within a single
 * process via node --test).
 */
import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

import { checkInternalAccess, checkAdminAccess, checkPublicAssistantAccess } from '../api-access'

const ENV_KEYS = [
  'ENABLE_INTERNAL_AGENT_API',
  'INTERNAL_API_SECRET',
  'ENABLE_ENGINE_SIMULATION',
  'ADMIN_API_SECRET',
  'PUBLIC_ASSISTANT_ACCESS_MODE',
  'VERCEL_ENV',
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
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = savedEnv[key]
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
    // INTERNAL_API_SECRET intentionally left unset
    const result = checkInternalAccess(makeRequest('Bearer whatever'))
    assert.equal(result.allowed, false)
    if (!result.allowed) assert.equal(result.response.status, 404)
  })

  test('denies with 404 when ENABLE_INTERNAL_AGENT_API is not the literal string "true"', () => {
    process.env['ENABLE_INTERNAL_AGENT_API'] = 'yes' // not the exact accepted value
    process.env['INTERNAL_API_SECRET'] = 'correct-secret-value-123'
    const result = checkInternalAccess(makeRequest('Bearer correct-secret-value-123'))
    assert.equal(result.allowed, false)
    if (!result.allowed) assert.equal(result.response.status, 404)
  })

  test('denies with 404 when ENABLE_INTERNAL_AGENT_API is unset entirely', () => {
    process.env['INTERNAL_API_SECRET'] = 'correct-secret-value-123'
    const result = checkInternalAccess(makeRequest('Bearer correct-secret-value-123'))
    assert.equal(result.allowed, false)
    if (!result.allowed) assert.equal(result.response.status, 404)
  })

  test('denies with 401 when enabled and configured, but no Authorization header is present', () => {
    process.env['ENABLE_INTERNAL_AGENT_API'] = 'true'
    process.env['INTERNAL_API_SECRET'] = 'correct-secret-value-123'
    const result = checkInternalAccess(makeRequest())
    assert.equal(result.allowed, false)
    if (!result.allowed) assert.equal(result.response.status, 401)
  })

  test('denies with 403 when enabled and configured, but the bearer token is wrong', () => {
    process.env['ENABLE_INTERNAL_AGENT_API'] = 'true'
    process.env['INTERNAL_API_SECRET'] = 'correct-secret-value-123'
    const result = checkInternalAccess(makeRequest('Bearer totally-wrong-token'))
    assert.equal(result.allowed, false)
    if (!result.allowed) assert.equal(result.response.status, 403)
  })

  test('denies with 403 when the bearer token has a different length than the configured secret', () => {
    process.env['ENABLE_INTERNAL_AGENT_API'] = 'true'
    process.env['INTERNAL_API_SECRET'] = 'a-secret-of-a-particular-length'
    const result = checkInternalAccess(makeRequest('Bearer short'))
    assert.equal(result.allowed, false)
    if (!result.allowed) assert.equal(result.response.status, 403)
  })

  test('allows when enabled, configured, and the exact correct bearer token is supplied', () => {
    process.env['ENABLE_INTERNAL_AGENT_API'] = 'true'
    process.env['INTERNAL_API_SECRET'] = 'correct-secret-value-123'
    const result = checkInternalAccess(makeRequest('Bearer correct-secret-value-123'))
    assert.equal(result.allowed, true)
  })

  test('is case-insensitive on the "Bearer" scheme keyword but not on the secret value itself', () => {
    process.env['ENABLE_INTERNAL_AGENT_API'] = 'true'
    process.env['INTERNAL_API_SECRET'] = 'CaseSensitiveSecret'
    const wrongCase = checkInternalAccess(makeRequest('bearer casesensitivesecret'))
    assert.equal(wrongCase.allowed, false, 'the secret value itself must remain case-sensitive')
    const rightCase = checkInternalAccess(makeRequest('bearer CaseSensitiveSecret'))
    assert.equal(
      rightCase.allowed,
      true,
      'the "Bearer"/"bearer" scheme keyword itself may be case-insensitive per RFC 6750 convention',
    )
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
    process.env['ADMIN_API_SECRET'] = 'admin-secret-abc'
    const result = checkAdminAccess(makeRequest('Bearer admin-secret-abc'))
    assert.equal(result.allowed, false)
    if (!result.allowed) assert.equal(result.response.status, 404)
  })

  test('denies with 401 when no Authorization header is present', () => {
    process.env['ENABLE_ENGINE_SIMULATION'] = 'true'
    process.env['ADMIN_API_SECRET'] = 'admin-secret-abc'
    const result = checkAdminAccess(makeRequest())
    assert.equal(result.allowed, false)
    if (!result.allowed) assert.equal(result.response.status, 401)
  })

  test('denies with 403 when the bearer token is wrong', () => {
    process.env['ENABLE_ENGINE_SIMULATION'] = 'true'
    process.env['ADMIN_API_SECRET'] = 'admin-secret-abc'
    const result = checkAdminAccess(makeRequest('Bearer wrong'))
    assert.equal(result.allowed, false)
    if (!result.allowed) assert.equal(result.response.status, 403)
  })

  test('allows when enabled, configured, and the exact correct bearer token is supplied', () => {
    process.env['ENABLE_ENGINE_SIMULATION'] = 'true'
    process.env['ADMIN_API_SECRET'] = 'admin-secret-abc'
    const result = checkAdminAccess(makeRequest('Bearer admin-secret-abc'))
    assert.equal(result.allowed, true)
  })

  test('INTERNAL_API_SECRET does not satisfy the admin guard, and ADMIN_API_SECRET does not satisfy the internal guard (separate trust boundaries)', () => {
    process.env['ENABLE_INTERNAL_AGENT_API'] = 'true'
    process.env['INTERNAL_API_SECRET'] = 'internal-only-secret'
    process.env['ENABLE_ENGINE_SIMULATION'] = 'true'
    process.env['ADMIN_API_SECRET'] = 'admin-only-secret'

    const adminTokenAgainstInternalGuard = checkInternalAccess(
      makeRequest('Bearer admin-only-secret'),
    )
    assert.equal(
      adminTokenAgainstInternalGuard.allowed,
      false,
      'ADMIN_API_SECRET must not grant internal access',
    )

    const internalTokenAgainstAdminGuard = checkAdminAccess(
      makeRequest('Bearer internal-only-secret'),
    )
    assert.equal(
      internalTokenAgainstAdminGuard.allowed,
      false,
      'INTERNAL_API_SECRET must not grant admin access',
    )
  })
})

// ── checkPublicAssistantAccess (/api/assistant) ─────────────────────────────────

describe('checkPublicAssistantAccess — fail-closed behavior, production override', () => {
  test('denies with 503 when PUBLIC_ASSISTANT_ACCESS_MODE is unset', () => {
    const result = checkPublicAssistantAccess()
    assert.equal(result.allowed, false)
    if (!result.allowed) assert.equal(result.response.status, 503)
  })

  test('denies with 503 when PUBLIC_ASSISTANT_ACCESS_MODE is an unrecognized value (e.g. a typo)', () => {
    process.env['PUBLIC_ASSISTANT_ACCESS_MODE'] = 'enabled' // not a recognized value
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

  test('allows "preview-only" mode outside production (VERCEL_ENV unset, i.e. local development)', () => {
    process.env['PUBLIC_ASSISTANT_ACCESS_MODE'] = 'preview-only'
    // VERCEL_ENV intentionally left unset — simulates local development
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
    process.env['INTERNAL_API_SECRET'] = 'super-secret-value-should-never-leak'
    const result = checkInternalAccess(makeRequest('Bearer wrong-token'))
    assert.equal(result.allowed, false)
    if (!result.allowed) {
      const bodyText = await result.response.clone().text()
      assert.equal(
        bodyText.includes('super-secret-value-should-never-leak'),
        false,
        'response body must never contain the configured secret',
      )
      assert.equal(
        result.internalReason.includes('super-secret-value-should-never-leak'),
        false,
        'internal log reason must never contain the configured secret either',
      )
    }
  })
})
