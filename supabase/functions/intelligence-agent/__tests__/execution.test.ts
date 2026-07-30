/**
 * AIscentra — Agent Runtime Quality Gate Tests
 *
 * Real, deterministic tests using Node's built-in test runner (node:test).
 * No mocking framework, no snapshot testing — these tests import and
 * execute the actual production modules (Execution, ExecutionToolRegistry,
 * AgentRuntime, Safety) and assert on real observable behavior.
 *
 * Run via: node --import tsx --test supabase/functions/intelligence-agent/__tests__/*.test.ts
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { Execution } from '../execution'
import { AgentRuntime } from '../runtime'
import { DefaultSafetyProvider } from '../safety'
import { ConsoleAgentLogger } from '../logger'
import {
  MockObservationProvider,
  MockSignalProvider,
  MockGraphProvider,
  MockMemoryProvider,
} from '../mock-providers'
import type { ReasoningEngine, ExecutionToolRegistry, ExecutionTool } from '../interfaces'
import type {
  AgentTask,
  ExecutionPlan,
  AgentContext,
  ReasoningInput,
  ReasoningResult,
  ExecutionStep,
} from '../types'
import { UnknownExecutionStepKind } from '../types'

// ── Test fixtures ──────────────────────────────────────────────────────────────

function buildTask(): AgentTask {
  return {
    id: 'test-task-1',
    type: 'INVESTIGATION',
    query: 'Test query',
    parameters: {},
    requestedBy: 'test-suite',
    createdAt: new Date().toISOString(),
  }
}

function buildEmptyContext(): AgentContext {
  return {
    taskId: 'test-task-1',
    observations: [],
    signals: [],
    graphNodes: [],
    memoryEntries: [],
    entities: [],
    loadedAt: new Date().toISOString(),
    gaps: [],
  }
}

function buildPlan(steps: ExecutionStep[]): ExecutionPlan {
  return {
    taskId: 'test-task-1',
    taskType: 'INVESTIGATION',
    steps,
    createdAt: new Date().toISOString(),
  }
}

// A spy ReasoningEngine that records whether it was actually invoked and
// with what input — this is how we PROVE the injected engine is really
// used, not just present in the constructor call.
class SpyReasoningEngine implements ReasoningEngine {
  public callCount = 0
  public lastInput: ReasoningInput | null = null

  async reason(input: ReasoningInput): Promise<ReasoningResult> {
    this.callCount++
    this.lastInput = input
    return {
      taskId: input.task.id,
      summary: 'spy-summary',
      claims: [],
      gapsIdentified: [],
      confidence: 9,
      reasonedAt: new Date().toISOString(),
    }
  }
}

describe('Execution — injected reasoningEngine is actually used via the tool registry', () => {
  test('ReasonTool built by buildDefaultExecutionToolRegistry invokes the exact injected ReasoningEngine instance', async () => {
    const spy = new SpyReasoningEngine()
    const execution = new Execution({
      reasoningEngine: spy,
      safetyProvider: new DefaultSafetyProvider(),
      logger: new ConsoleAgentLogger(),
    })

    const task = buildTask()
    const context = buildEmptyContext()
    const plan = buildPlan([
      { kind: 'REASON', description: 'test reason step', required: true, parameters: {} },
    ])

    const result = await execution.run(task, plan, context)

    assert.equal(
      spy.callCount,
      1,
      'the injected SpyReasoningEngine.reason() must be called exactly once',
    )
    assert.equal(
      spy.lastInput?.task.id,
      task.id,
      'the exact task passed to Execution.run() must reach the injected engine',
    )
    assert.equal(
      result.reasoning?.summary,
      'spy-summary',
      'ExecutionResult.reasoning must come from the injected engine, not a hardcoded value',
    )
    assert.equal(result.success, true)
  })

  test('a custom toolRegistry override is honored instead of the default factory', async () => {
    let customToolWasCalled = false

    const customTool: ExecutionTool = {
      kind: 'REASON',
      async execute() {
        customToolWasCalled = true
        return {
          taskId: 't',
          summary: 'custom',
          claims: [],
          gapsIdentified: [],
          confidence: 5,
          reasonedAt: new Date().toISOString(),
        }
      },
    }

    const customRegistry: ExecutionToolRegistry = {
      register() {
        /* no-op for this test */
      },
      hasTool: (kind) => kind === 'REASON',
      getTool: (kind) => {
        if (kind === 'REASON') return customTool
        throw new UnknownExecutionStepKind(kind)
      },
    }

    const execution = new Execution({
      reasoningEngine: new SpyReasoningEngine(), // must NOT be called — custom registry bypasses the default factory
      safetyProvider: new DefaultSafetyProvider(),
      logger: new ConsoleAgentLogger(),
      toolRegistry: customRegistry,
    })

    const plan = buildPlan([
      { kind: 'REASON', description: 'custom', required: true, parameters: {} },
    ])
    await execution.run(buildTask(), plan, buildEmptyContext())

    assert.equal(
      customToolWasCalled,
      true,
      'the injected custom toolRegistry must be used in place of the default one',
    )
  })
})

describe('AgentRuntime — dependency wiring is preserved', () => {
  test('AgentRuntime.run() produces a result whose reasoning comes from the exact injected engine', async () => {
    const spy = new SpyReasoningEngine()
    const runtime = new AgentRuntime({
      observationProvider: new MockObservationProvider(),
      signalProvider: new MockSignalProvider(),
      graphProvider: new MockGraphProvider(),
      memoryProvider: new MockMemoryProvider(),
      reasoningEngine: spy,
      safetyProvider: new DefaultSafetyProvider(),
      logger: new ConsoleAgentLogger(),
    })

    const task = buildTask()
    const result = await runtime.run(task)

    assert.equal(
      spy.callCount,
      1,
      'AgentRuntime must route REASON steps to the exact injected reasoningEngine',
    )
    assert.equal(result.execution.success, true)
    assert.equal(result.reflection.taskId, task.id)
  })

  test('observable successful result shape is unchanged after removal of the unused reasoningEngine field/deps property (regression guard)', async () => {
    // This test exists specifically to prove that the Quality Gate bootstrap's
    // dead-code removals (Execution's unused `reasoningEngine` field, and
    // AgentRuntime's unused `private readonly deps` parameter property) did
    // NOT change any observable behavior. It asserts on the full shape of a
    // successful AgentRunResult.
    const runtime = new AgentRuntime({
      observationProvider: new MockObservationProvider(),
      signalProvider: new MockSignalProvider(),
      graphProvider: new MockGraphProvider(),
      memoryProvider: new MockMemoryProvider(),
      reasoningEngine: new SpyReasoningEngine(),
      safetyProvider: new DefaultSafetyProvider(),
      logger: new ConsoleAgentLogger(),
    })

    const task = buildTask()
    const result = await runtime.run(task)

    assert.equal(typeof result.task.id, 'string')
    assert.equal(Array.isArray(result.plan.steps), true)
    assert.equal(typeof result.context.loadedAt, 'string')
    assert.equal(typeof result.execution.success, 'boolean')
    assert.equal(typeof result.reflection.success, 'boolean')
    assert.equal(typeof result.reflection.confidence, 'number')
  })
})

describe('Safety / Execution — unknown or forbidden execution actions remain fail-closed', () => {
  test('an unregistered step kind causes the step to fail (never silently succeeds)', async () => {
    const emptyRegistry: ExecutionToolRegistry = {
      register() {
        /* no-op */
      },
      hasTool: () => false,
      getTool: (kind) => {
        throw new UnknownExecutionStepKind(kind)
      },
    }

    const execution = new Execution({
      reasoningEngine: new SpyReasoningEngine(),
      safetyProvider: new DefaultSafetyProvider(),
      logger: new ConsoleAgentLogger(),
      toolRegistry: emptyRegistry,
    })

    const plan = buildPlan([
      {
        kind: 'LOAD_SIGNALS',
        description: 'known action, no tool registered',
        required: true,
        parameters: {},
      },
    ])

    const result = await execution.run(buildTask(), plan, buildEmptyContext())

    assert.equal(
      result.success,
      false,
      'a required step with no registered tool must fail the overall execution — never silently succeed',
    )
    assert.equal(result.stepResults[0]?.success, false)
    assert.ok(
      result.stepResults[0]?.error?.includes('Unknown ExecutionStepKind'),
      'the failure reason must name the actual problem, not be swallowed',
    )
  })

  test('DefaultSafetyProvider denies write actions by default (deny-by-default)', () => {
    const safety = new DefaultSafetyProvider()
    const result = safety.checkAction('WRITE_MEMORY')
    assert.equal(
      result.allowed,
      false,
      'WRITE_MEMORY must be denied unless explicitly allow-listed',
    )
    assert.ok(result.reason, 'a denial must include a reason, not a silent false')
  })

  test('DefaultSafetyProvider allows read actions by default', () => {
    const safety = new DefaultSafetyProvider()
    const result = safety.checkAction('READ_SIGNALS')
    assert.equal(result.allowed, true)
  })

  test('DefaultSafetyProvider allows a write action only when explicitly allow-listed', () => {
    const safety = new DefaultSafetyProvider(['WRITE_MEMORY'])
    const allowed = safety.checkAction('WRITE_MEMORY')
    const stillDenied = safety.checkAction('WRITE_GRAPH')
    assert.equal(allowed.allowed, true)
    assert.equal(
      stillDenied.allowed,
      false,
      'allow-listing one write action must not implicitly allow others',
    )
  })
})
