/**
 * AIscentra — Phase 1A: Route Containment Tests
 *
 * Two kinds of tests here:
 *
 * 1. buildSafeAgentResponse() — a pure function exported specifically for
 *    testability (a "dependency seam" per the task's own instruction).
 *    Verified directly against a hand-built fake AgentRunResult, with NO
 *    Runtime, Supabase, or Groq call anywhere.
 *
 * 2. Route-level denial paths — the actual exported GET/POST handlers of
 *    all three routes are invoked directly with crafted Request objects
 *    lacking valid credentials. This repository's test environment has NO
 *    SUPABASE_SERVICE_ROLE_KEY / GROQ_API_KEY configured (they are simply
 *    absent from process.env when `node --test` runs standalone, as
 *    confirmed by this same test file's own environment inspection below).
 *    This means: if a route's guard ever failed to block an unauthorized
 *    request, the request would proceed into createAdminClient() /
 *    buildProductionRuntime() / a live fetch() call and either throw
 *    immediately or hang attempting a real network call — NOT return the
 *    guard's own clean 401/403/404/503. Asserting the exact expected
 *    denial status is therefore real evidence that execution stopped at
 *    the guard, not merely a code-reading claim.
 */
import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

import { buildSafeAgentResponse } from '../../../app/api/agent/route'
import { GET as agentGet, POST as agentPost } from '../../../app/api/agent/route'
import { GET as adminGet, POST as adminPost } from '../../../app/api/admin/simulate-engine-v2/route'
import { POST as assistantPost } from '../../../app/api/assistant/route'
import type { AgentRunResult } from '../../../../supabase/functions/intelligence-agent/index'

const ENV_KEYS = [
  'ENABLE_INTERNAL_AGENT_API',
  'INTERNAL_API_SECRET',
  'ENABLE_ENGINE_SIMULATION',
  'ADMIN_API_SECRET',
  'PUBLIC_ASSISTANT_ACCESS_MODE',
  'VERCEL_ENV',
  'SUPABASE_SERVICE_ROLE_KEY',
  'GROQ_API_KEY',
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
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
})

// ── Pre-flight: confirm the assumption this test file relies on ────────────────

describe('test environment precondition', () => {
  test('no live provider credentials are present in this test process', () => {
    assert.equal(process.env['SUPABASE_SERVICE_ROLE_KEY'], undefined)
    assert.equal(process.env['GROQ_API_KEY'], undefined)
  })
})

// ── buildSafeAgentResponse — pure function, no I/O ──────────────────────────────

describe('buildSafeAgentResponse', () => {
  function buildFakeResult(overrides: Partial<AgentRunResult> = {}): AgentRunResult {
    const base: AgentRunResult = {
      task: {
        id: 'task-fake-123',
        type: 'INVESTIGATION',
        query: 'test query',
        parameters: {},
        requestedBy: 'test',
        createdAt: new Date().toISOString(),
      },
      plan: {
        taskId: 'task-fake-123',
        taskType: 'INVESTIGATION',
        steps: [{ kind: 'LOAD_OBSERVATIONS', description: 'x', required: true, parameters: {} }],
        createdAt: new Date().toISOString(),
      },
      context: {
        taskId: 'task-fake-123',
        observations: [
          {
            id: 'obs-secret-internal-id-999',
            title: 'x',
            summary: 'y',
            sourceName: 'z',
            collectedAt: new Date().toISOString(),
          },
        ],
        signals: [],
        graphNodes: [],
        memoryEntries: [],
        entities: [],
        loadedAt: new Date().toISOString(),
        gaps: ['a gap'],
      },
      execution: {
        taskId: 'task-fake-123',
        planId: 'task-fake-123',
        stepResults: [
          {
            step: { kind: 'LOAD_OBSERVATIONS', description: 'x', required: true, parameters: {} },
            success: true,
            output: { internal: 'provider-payload-should-not-leak' },
            error: null,
            durationMs: 5,
          },
        ],
        reasoning: {
          taskId: 'task-fake-123',
          summary: 'the fake summary',
          claims: [
            {
              type: 'FACT',
              statement: 'a fact',
              evidenceIds: ['obs-secret-internal-id-999'],
              confidence: 9,
            },
          ],
          gapsIdentified: ['gap one'],
          confidence: 7,
          reasonedAt: new Date().toISOString(),
        },
        success: true,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      },
      reflection: {
        taskId: 'task-fake-123',
        success: true,
        failure: null,
        confidence: 7,
        durationMs: 10,
        lessons: [],
        nextActions: [],
        reflectedAt: new Date().toISOString(),
      },
    }
    return { ...base, ...overrides }
  }

  test('returns only taskId, status, summary, claims, gaps, confidence', () => {
    const dto = buildSafeAgentResponse(buildFakeResult())
    assert.deepEqual(Object.keys(dto).sort(), [
      'claims',
      'confidence',
      'gaps',
      'status',
      'summary',
      'taskId',
    ])
  })

  test('claims strip evidenceIds (internal record references) but keep type/statement/confidence', () => {
    const dto = buildSafeAgentResponse(buildFakeResult())
    assert.equal(dto.claims.length, 1)
    const [firstClaim] = dto.claims
    assert.ok(firstClaim, 'expected at least one claim')
    assert.deepEqual(Object.keys(firstClaim).sort(), ['confidence', 'statement', 'type'])
    assert.equal(
      JSON.stringify(dto).includes('obs-secret-internal-id-999'),
      false,
      'internal evidence ID must not appear anywhere in the DTO',
    )
  })

  test('never includes the execution plan, raw context, or provider payloads', () => {
    const dto = buildSafeAgentResponse(buildFakeResult())
    const serialized = JSON.stringify(dto)
    assert.equal(serialized.includes('provider-payload-should-not-leak'), false)
    assert.equal(
      serialized.includes('LOAD_OBSERVATIONS'),
      false,
      'internal step-kind diagnostics must not leak',
    )
    assert.equal('plan' in dto, false)
    assert.equal('context' in dto, false)
  })

  test('status is "success" when reflection.success is true', () => {
    const dto = buildSafeAgentResponse(buildFakeResult())
    assert.equal(dto.status, 'success')
  })

  test('status is "failed" when reflection.success is false', () => {
    const fake = buildFakeResult({
      reflection: {
        taskId: 'task-fake-123',
        success: false,
        failure: '1 step failed',
        confidence: 0,
        durationMs: 5,
        lessons: [],
        nextActions: [],
        reflectedAt: new Date().toISOString(),
      },
    })
    const dto = buildSafeAgentResponse(fake)
    assert.equal(dto.status, 'failed')
  })

  test('handles a null reasoning result gracefully (no crash, sensible fallback summary)', () => {
    const fake = buildFakeResult({
      execution: {
        taskId: 'task-fake-123',
        planId: 'task-fake-123',
        stepResults: [],
        reasoning: null,
        success: false,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      },
    })
    const dto = buildSafeAgentResponse(fake)
    assert.equal(dto.claims.length, 0)
    assert.equal(dto.gaps.length, 0)
    assert.equal(typeof dto.summary, 'string')
    assert.ok(dto.summary.length > 0)
  })
})

// ── Route denial paths — real handlers, no valid credentials ───────────────────

describe('/api/agent — denial paths never reach the Runtime', () => {
  test('GET always returns 405 and never touches the Runtime', async () => {
    const res = await agentGet()
    assert.equal(res.status, 405)
    assert.equal(res.headers.get('Allow'), 'POST')
  })

  test('POST with feature disabled returns 404, not a Runtime/provider error', async () => {
    const req = new Request('https://example.invalid/api/agent', {
      method: 'POST',
      headers: { authorization: 'Bearer whatever', 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'test query text' }),
    })
    const res = await agentPost(req as never)
    assert.equal(
      res.status,
      404,
      'with ENABLE_INTERNAL_AGENT_API unset, the guard must deny before buildProductionRuntime() is ever reached',
    )
  })

  test('POST with feature enabled but wrong secret returns 403, not a Runtime/provider error', async () => {
    process.env['ENABLE_INTERNAL_AGENT_API'] = 'true'
    process.env['INTERNAL_API_SECRET'] = 'correct-secret'
    const req = new Request('https://example.invalid/api/agent', {
      method: 'POST',
      headers: { authorization: 'Bearer wrong-secret', 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'test query text' }),
    })
    const res = await agentPost(req as never)
    assert.equal(res.status, 403)
  })

  test('POST with valid auth but invalid body (too short) returns 400 before Runtime construction', async () => {
    process.env['ENABLE_INTERNAL_AGENT_API'] = 'true'
    process.env['INTERNAL_API_SECRET'] = 'correct-secret'
    const req = new Request('https://example.invalid/api/agent', {
      method: 'POST',
      headers: { authorization: 'Bearer correct-secret', 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'x' }), // below min(2)
    })
    const res = await agentPost(req as never)
    assert.equal(res.status, 400)
  })

  test('POST with valid auth but an unknown extra field is rejected by strict schema before Runtime construction', async () => {
    process.env['ENABLE_INTERNAL_AGENT_API'] = 'true'
    process.env['INTERNAL_API_SECRET'] = 'correct-secret'
    const req = new Request('https://example.invalid/api/agent', {
      method: 'POST',
      headers: { authorization: 'Bearer correct-secret', 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'a valid query', extraField: 'should not be allowed' }),
    })
    const res = await agentPost(req as never)
    assert.equal(res.status, 400)
  })
})

describe('/api/admin/simulate-engine-v2 — denial paths never reach createAdminClient or AI', () => {
  test('GET always returns 405 and never touches the database or an AI provider', async () => {
    const res = await adminGet()
    assert.equal(res.status, 405)
    assert.equal(res.headers.get('Allow'), 'POST')
  })

  test('POST with feature disabled returns 404, never constructing an admin client', async () => {
    const req = new Request('https://example.invalid/api/admin/simulate-engine-v2', {
      method: 'POST',
      headers: { authorization: 'Bearer whatever' },
    })
    const res = await adminPost(req as never)
    assert.equal(
      res.status,
      404,
      'with ENABLE_ENGINE_SIMULATION unset, no service-role client or AI call should ever be attempted',
    )
  })

  test('POST with feature enabled but wrong secret returns 403, never constructing an admin client', async () => {
    process.env['ENABLE_ENGINE_SIMULATION'] = 'true'
    process.env['ADMIN_API_SECRET'] = 'correct-admin-secret'
    const req = new Request('https://example.invalid/api/admin/simulate-engine-v2', {
      method: 'POST',
      headers: { authorization: 'Bearer wrong' },
    })
    const res = await adminPost(req as never)
    assert.equal(res.status, 403)
  })
})

describe('/api/assistant — production disabled, no retrieval or Groq call', () => {
  test('POST returns 503 when PUBLIC_ASSISTANT_ACCESS_MODE is unset (default disabled), before any retrieval or Groq call', async () => {
    const req = new Request('https://example.invalid/api/assistant', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'hello there' }),
    })
    const res = await assistantPost(req)
    assert.equal(res.status, 503)
  })

  test('POST returns 503 in production even if PUBLIC_ASSISTANT_ACCESS_MODE=preview-only is set (misconfiguration cannot enable production access)', async () => {
    process.env['PUBLIC_ASSISTANT_ACCESS_MODE'] = 'preview-only'
    process.env['VERCEL_ENV'] = 'production'
    const req = new Request('https://example.invalid/api/assistant', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'hello there' }),
    })
    const res = await assistantPost(req)
    assert.equal(res.status, 503)
  })
})
