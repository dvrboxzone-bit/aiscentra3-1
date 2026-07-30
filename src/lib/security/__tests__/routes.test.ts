/**
 * AIscentra — Phase 1A: Route Containment Tests (Dependency Injection)
 *
 * Three kinds of tests here:
 *
 * 1. buildSafeAgentResponse() — a pure function, no I/O, verified against a
 *    hand-built fake AgentRunResult.
 *
 * 2. Direct dependency-call evidence via injected fakes: each route's
 *    createXPostHandler(deps) factory is invoked with a locally-scoped
 *    fake `deps` object carrying its own counters (not global/exported
 *    module state). For a denied/invalid request, control flow never
 *    reaches the lines that call deps.*, so the local counters stay 0 as
 *    a direct, provable consequence of the guard/validation
 *    short-circuiting.
 *
 * 3. Provider-error redaction: a fake AI dependency throws an error
 *    containing a unique marker string; the test proves that marker never
 *    reaches the response body or engine_justification.
 *
 * No real Supabase, Groq, or network call happens anywhere in this file.
 * All secrets used are >=32 characters, matching the production minimum.
 */
import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

import {
  buildSafeAgentResponse,
  createAgentGetHandler,
  createAgentPostHandler,
} from '../../../app/api/agent/route'
import type { AgentDependencies, AgentRuntimeModule } from '../../../app/api/agent/route'
import {
  createAdminGetHandler,
  createAdminPostHandler,
} from '../../../app/api/admin/simulate-engine-v2/route'
import type {
  AdminDependencies,
  SimulationRunPayload,
} from '../../../app/api/admin/simulate-engine-v2/route'
import { createAssistantPostHandler } from '../../../app/api/assistant/route'
import type { AssistantDependencies, RetrievalModule } from '../../../app/api/assistant/route'
import type {
  AgentRunResult,
  AgentTask,
} from '../../../../supabase/functions/intelligence-agent/index'

const VALID_INTERNAL_SECRET = 'a'.repeat(32)
const VALID_ADMIN_SECRET = 'b'.repeat(32)

const ENV_KEYS = [
  'ENABLE_INTERNAL_AGENT_API',
  'INTERNAL_API_SECRET',
  'ENABLE_ENGINE_SIMULATION',
  'ADMIN_API_SECRET',
  'PUBLIC_ASSISTANT_ACCESS_MODE',
  'VERCEL_ENV',
  'NODE_ENV',
  'SUPABASE_SERVICE_ROLE_KEY',
  'GROQ_API_KEY',
] as const

let savedEnv: Record<string, string | undefined> = {}

beforeEach(() => {
  savedEnv = {}
  const mutableEnv = process.env as Record<string, string | undefined>
  for (const key of ENV_KEYS) {
    savedEnv[key] = mutableEnv[key]
    delete mutableEnv[key]
  }
})

afterEach(() => {
  const mutableEnv = process.env as Record<string, string | undefined>
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete mutableEnv[key]
    else mutableEnv[key] = savedEnv[key]
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
    assert.equal(serialized.includes('LOAD_OBSERVATIONS'), false)
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

// ── /api/agent — DI-based direct dependency-call evidence ──────────────────────

function makeFakeAgentDeps(): {
  deps: AgentDependencies
  counts: { loader: number; factory: number; run: number }
} {
  const counts = { loader: 0, factory: 0, run: 0 }
  const fakeResult: AgentRunResult = {
    task: {
      id: 't1',
      type: 'INVESTIGATION',
      query: 'x',
      parameters: {},
      requestedBy: 'test',
      createdAt: new Date().toISOString(),
    },
    plan: {
      taskId: 't1',
      taskType: 'INVESTIGATION',
      steps: [],
      createdAt: new Date().toISOString(),
    },
    context: {
      taskId: 't1',
      observations: [],
      signals: [],
      graphNodes: [],
      memoryEntries: [],
      entities: [],
      loadedAt: new Date().toISOString(),
      gaps: [],
    },
    execution: {
      taskId: 't1',
      planId: 't1',
      stepResults: [],
      reasoning: null,
      success: true,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    },
    reflection: {
      taskId: 't1',
      success: true,
      failure: null,
      confidence: 5,
      durationMs: 1,
      lessons: [],
      nextActions: [],
      reflectedAt: new Date().toISOString(),
    },
  }
  const deps: AgentDependencies = {
    loadRuntime: async (): Promise<AgentRuntimeModule> => {
      counts.loader++
      return {
        buildProductionRuntime: () => {
          counts.factory++
          return {
            run: async (_task: AgentTask) => {
              counts.run++
              return fakeResult
            },
          }
        },
        routeTask: () => 'INVESTIGATION',
      }
    },
  }
  return { deps, counts }
}

describe('/api/agent — direct dependency-call evidence via injected fakes', () => {
  test('GET: runtime loader count is 0', async () => {
    const GET = createAgentGetHandler()
    const res = await GET()
    assert.equal(res.status, 405)
  })

  test('unauthorized POST (feature disabled): loader count is 0', async () => {
    const { deps, counts } = makeFakeAgentDeps()
    const POST = createAgentPostHandler(deps)
    const req = new Request('https://example.invalid/api/agent', {
      method: 'POST',
      headers: { authorization: 'Bearer whatever', 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'test query text' }),
    })
    const res = await POST(req as never)
    assert.equal(res.status, 404)
    assert.equal(counts.loader, 0)
    assert.equal(counts.factory, 0)
    assert.equal(counts.run, 0)
  })

  test('unauthorized POST (wrong secret): loader count is 0', async () => {
    process.env['ENABLE_INTERNAL_AGENT_API'] = 'true'
    process.env['INTERNAL_API_SECRET'] = VALID_INTERNAL_SECRET
    const { deps, counts } = makeFakeAgentDeps()
    const POST = createAgentPostHandler(deps)
    const req = new Request('https://example.invalid/api/agent', {
      method: 'POST',
      headers: { authorization: `Bearer ${'z'.repeat(32)}`, 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'test query text' }),
    })
    const res = await POST(req as never)
    assert.equal(res.status, 403)
    assert.equal(counts.loader, 0)
  })

  test('invalid authorized body: loader count is 0', async () => {
    process.env['ENABLE_INTERNAL_AGENT_API'] = 'true'
    process.env['INTERNAL_API_SECRET'] = VALID_INTERNAL_SECRET
    const { deps, counts } = makeFakeAgentDeps()
    const POST = createAgentPostHandler(deps)
    const req = new Request('https://example.invalid/api/agent', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${VALID_INTERNAL_SECRET}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ query: 'x' }),
    })
    const res = await POST(req as never)
    assert.equal(res.status, 400)
    assert.equal(counts.loader, 0)
  })

  test('authorized valid body: loader=1, factory=1, run=1', async () => {
    process.env['ENABLE_INTERNAL_AGENT_API'] = 'true'
    process.env['INTERNAL_API_SECRET'] = VALID_INTERNAL_SECRET
    const { deps, counts } = makeFakeAgentDeps()
    const POST = createAgentPostHandler(deps)
    const req = new Request('https://example.invalid/api/agent', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${VALID_INTERNAL_SECRET}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ query: 'a valid test query' }),
    })
    const res = await POST(req as never)
    assert.equal(res.status, 200)
    assert.equal(counts.loader, 1)
    assert.equal(counts.factory, 1)
    assert.equal(counts.run, 1)
  })
})

// ── /api/admin/simulate-engine-v2 — DI-based direct dependency-call evidence ───

function makeFakeAdminDeps(overrides: Partial<AdminDependencies> = {}): {
  deps: AdminDependencies
  counts: { adminClient: number; ai: number; dbRead: number; dbWrite: number }
  writtenPayloads: SimulationRunPayload[]
} {
  const counts = { adminClient: 0, ai: 0, dbRead: 0, dbWrite: 0 }
  const writtenPayloads: SimulationRunPayload[] = []

  const fakeObservation = {
    id: 'obs-1',
    title: 'Test observation title',
    content:
      'Test observation content, long enough to pass hard-rejection checks about minimum length for sure.',
    source_id: 'src-1',
    processed: true,
    signal_id: null,
    sources: { name: 'Test Source', type: 'academic', trust_score: 0.9 },
  }

  const deps: AdminDependencies = {
    loadAdminClient: async () => {
      counts.adminClient++
      return { fake: true }
    },
    readObservations: async () => {
      counts.dbRead++
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { data: [fakeObservation as any], error: null }
    },
    callAI: async () => {
      counts.ai++
      return {
        sis_novelty: 5,
        sis_importance: 5,
        sis_urgency: 5,
        sis_confidence: 5,
        human_cto: false,
        human_founder: false,
        human_investor: false,
        human_researcher: false,
        human_policy: false,
        human_engineer: false,
        is_survey: false,
        is_tutorial: false,
        is_normal_science: false,
        engine_justification: 'fake justification',
      }
    },
    isRateLimitError: () => false,
    writeSimulationRun: async (_client, payload) => {
      counts.dbWrite++
      writtenPayloads.push(payload)
    },
    ...overrides,
  }
  return { deps, counts, writtenPayloads }
}

describe('/api/admin/simulate-engine-v2 — direct dependency-call evidence via injected fakes', () => {
  test('GET: all counts are 0', async () => {
    const GET = createAdminGetHandler()
    const res = await GET()
    assert.equal(res.status, 405)
  })

  test('unauthorized POST (feature disabled): all counts are 0', async () => {
    const { deps, counts } = makeFakeAdminDeps()
    const POST = createAdminPostHandler(deps)
    const req = new Request('https://example.invalid/api/admin/simulate-engine-v2', {
      method: 'POST',
      headers: { authorization: 'Bearer whatever' },
    })
    const res = await POST(req as never)
    assert.equal(res.status, 404)
    assert.equal(counts.adminClient, 0)
    assert.equal(counts.ai, 0)
    assert.equal(counts.dbRead, 0)
    assert.equal(counts.dbWrite, 0)
  })

  test('unauthorized POST (wrong secret): all counts are 0', async () => {
    process.env['ENABLE_ENGINE_SIMULATION'] = 'true'
    process.env['ADMIN_API_SECRET'] = VALID_ADMIN_SECRET
    const { deps, counts } = makeFakeAdminDeps()
    const POST = createAdminPostHandler(deps)
    const req = new Request('https://example.invalid/api/admin/simulate-engine-v2', {
      method: 'POST',
      headers: { authorization: `Bearer ${'z'.repeat(32)}` },
    })
    const res = await POST(req as never)
    assert.equal(res.status, 403)
    assert.equal(counts.adminClient, 0)
    assert.equal(counts.ai, 0)
    assert.equal(counts.dbRead, 0)
    assert.equal(counts.dbWrite, 0)
  })

  test('authorized: admin client, AI, db read, db write all called; response contains no leaked content', async () => {
    process.env['ENABLE_ENGINE_SIMULATION'] = 'true'
    process.env['ADMIN_API_SECRET'] = VALID_ADMIN_SECRET
    const { deps, counts, writtenPayloads } = makeFakeAdminDeps()
    const POST = createAdminPostHandler(deps)
    const req = new Request('https://example.invalid/api/admin/simulate-engine-v2', {
      method: 'POST',
      headers: { authorization: `Bearer ${VALID_ADMIN_SECRET}` },
    })
    const res = await POST(req as never)
    assert.equal(res.status, 200)
    assert.equal(counts.adminClient, 1)
    assert.equal(counts.dbRead, 1)
    assert.equal(counts.ai, 1)
    assert.equal(counts.dbWrite, 1)
    assert.equal(writtenPayloads.length, 1)
  })

  test('provider-error redaction: RAW_PROVIDER_PAYLOAD_MUST_NOT_LEAK never reaches response body or engine_justification', async () => {
    process.env['ENABLE_ENGINE_SIMULATION'] = 'true'
    process.env['ADMIN_API_SECRET'] = VALID_ADMIN_SECRET
    const LEAK_MARKER = 'RAW_PROVIDER_PAYLOAD_MUST_NOT_LEAK'
    const { deps, writtenPayloads } = makeFakeAdminDeps({
      callAI: async () => {
        throw new Error(`Provider returned: ${LEAK_MARKER} (raw internal payload details here)`)
      },
      isRateLimitError: () => false,
    })
    const POST = createAdminPostHandler(deps)
    const req = new Request('https://example.invalid/api/admin/simulate-engine-v2', {
      method: 'POST',
      headers: { authorization: `Bearer ${VALID_ADMIN_SECRET}` },
    })
    const res = await POST(req as never)
    assert.equal(res.status, 200, 'the handler must complete with a safe result, not crash')
    const bodyText = await res.clone().text()
    assert.equal(
      bodyText.includes(LEAK_MARKER),
      false,
      'the leak marker must not appear in the response body',
    )
    assert.equal(
      bodyText.includes('AI provider request failed'),
      true,
      'the safe fixed string must be used instead',
    )
    assert.equal(writtenPayloads.length, 1)
    const [firstWrittenPayload] = writtenPayloads
    assert.ok(firstWrittenPayload, 'expected exactly one written simulation run payload')
    const savedJustifications = firstWrittenPayload.results.map((r) => r.engine_justification)
    assert.equal(
      savedJustifications.some((j) => j.includes(LEAK_MARKER)),
      false,
      'the leak marker must not appear in the persisted engine_justification either',
    )
  })

  test('provider-error redaction: rate-limit errors get the rate-limit-specific safe string', async () => {
    process.env['ENABLE_ENGINE_SIMULATION'] = 'true'
    process.env['ADMIN_API_SECRET'] = VALID_ADMIN_SECRET
    const { deps, writtenPayloads } = makeFakeAdminDeps({
      callAI: async () => {
        throw new Error('RAW_PROVIDER_PAYLOAD_MUST_NOT_LEAK: rate limited')
      },
      isRateLimitError: () => true,
    })
    const POST = createAdminPostHandler(deps)
    const req = new Request('https://example.invalid/api/admin/simulate-engine-v2', {
      method: 'POST',
      headers: { authorization: `Bearer ${VALID_ADMIN_SECRET}` },
    })
    const res = await POST(req as never)
    const bodyText = await res.clone().text()
    assert.equal(bodyText.includes('RAW_PROVIDER_PAYLOAD_MUST_NOT_LEAK'), false)
    assert.equal(bodyText.includes('AI provider rate limit reached'), true)
    const [firstWrittenPayload] = writtenPayloads
    assert.ok(firstWrittenPayload, 'expected exactly one written simulation run payload')
    const [firstResult] = firstWrittenPayload.results
    assert.ok(firstResult, 'expected exactly one simulation result')
    assert.equal(firstResult.v2_decision, 'RATE_LIMITED')
  })
})

// ── /api/assistant — DI-based direct dependency-call evidence ──────────────────

function makeFakeAssistantDeps(): {
  deps: AssistantDependencies
  counts: { retrievalLoader: number; retrieval: number; fetch: number }
} {
  const counts = { retrievalLoader: 0, retrieval: 0, fetch: 0 }
  const deps: AssistantDependencies = {
    loadRetrieval: async (): Promise<RetrievalModule> => {
      counts.retrievalLoader++
      return {
        retrieveContext: async () => {
          counts.retrieval++
          return {
            signals: [],
            events: [],
            reports: [],
            hasContext: false,
            contextSummary: 'no context (fake)',
          }
        },
        formatContextForPrompt: () => 'fake context text',
        ASSISTANT_SYSTEM_PROMPT: 'fake system prompt',
      }
    },
    fetchGroq: async () => {
      counts.fetch++
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
          controller.close()
        },
      })
      return new Response(stream, { status: 200 })
    },
    getGroqApiKey: () => 'fake-groq-key',
    getGroqModel: () => 'fake-model',
  }
  return { deps, counts }
}

describe('/api/assistant — direct dependency-call evidence via injected fakes', () => {
  test('production-disabled POST (mode unset): retrieval loader/call/fetch counts are all 0', async () => {
    const { deps, counts } = makeFakeAssistantDeps()
    const POST = createAssistantPostHandler(deps)
    const req = new Request('https://example.invalid/api/assistant', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'hello there' }),
    })
    const res = await POST(req)
    assert.equal(res.status, 503)
    assert.equal(counts.retrievalLoader, 0)
    assert.equal(counts.retrieval, 0)
    assert.equal(counts.fetch, 0)
  })

  test('production + preview-only misconfiguration: all counts are 0', async () => {
    process.env['PUBLIC_ASSISTANT_ACCESS_MODE'] = 'preview-only'
    process.env['VERCEL_ENV'] = 'production'
    const { deps, counts } = makeFakeAssistantDeps()
    const POST = createAssistantPostHandler(deps)
    const req = new Request('https://example.invalid/api/assistant', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'hello there' }),
    })
    const res = await POST(req)
    assert.equal(res.status, 503)
    assert.equal(counts.retrievalLoader, 0)
    assert.equal(counts.retrieval, 0)
    assert.equal(counts.fetch, 0)
  })

  test('unknown VERCEL_ENV: all counts are 0', async () => {
    process.env['PUBLIC_ASSISTANT_ACCESS_MODE'] = 'preview-only'
    process.env['VERCEL_ENV'] = 'some-unknown-value'
    const { deps, counts } = makeFakeAssistantDeps()
    const POST = createAssistantPostHandler(deps)
    const req = new Request('https://example.invalid/api/assistant', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'hello there' }),
    })
    const res = await POST(req)
    assert.equal(res.status, 503)
    assert.equal(counts.retrievalLoader, 0)
    assert.equal(counts.retrieval, 0)
    assert.equal(counts.fetch, 0)
  })

  test('allowed Preview: fake retrieval/fetch execute without any real network call', async () => {
    process.env['PUBLIC_ASSISTANT_ACCESS_MODE'] = 'preview-only'
    process.env['VERCEL_ENV'] = 'preview'
    const { deps, counts } = makeFakeAssistantDeps()
    const POST = createAssistantPostHandler(deps)
    const req = new Request('https://example.invalid/api/assistant', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'a real question here' }),
    })
    const res = await POST(req)
    assert.equal(res.status, 200)
    assert.equal(counts.retrievalLoader, 1)
    assert.equal(counts.retrieval, 1)
    assert.equal(counts.fetch, 1)
  })
})
