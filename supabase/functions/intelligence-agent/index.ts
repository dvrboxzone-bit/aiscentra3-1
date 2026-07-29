/**
 * AIscentra — Intelligence Agent Runtime: Assembly / Mock Test Entry Point
 *
 * Wires all mock providers into an AgentRuntime instance and exposes a
 * runMockTask() helper to exercise the full pipeline end-to-end without
 * any Supabase or LLM dependency.
 *
 * This is the Definition-of-Done verification harness:
 *   "Mock Agent proceeds through full cycle" is verified by calling
 *   runMockTask() and confirming an AgentRunResult is returned with
 *   a completed reflection.
 */
import { AgentRuntime } from './runtime'
import { ConsoleAgentLogger } from './logger'
import { DefaultSafetyProvider } from './safety'
import { MockReasoningEngine } from './reasoning-engine'
import {
  MockObservationProvider,
  MockSignalProvider,
  MockGraphProvider,
  MockMemoryProvider,
} from './mock-providers'
import { routeTask } from './task-router'
import type { AgentTask, AgentRunResult } from './types'

export function buildMockRuntime(): AgentRuntime {
  return new AgentRuntime({
    observationProvider: new MockObservationProvider(),
    signalProvider:       new MockSignalProvider(),
    graphProvider:        new MockGraphProvider(),
    memoryProvider:       new MockMemoryProvider(),
    reasoningEngine:      new MockReasoningEngine(),
    safetyProvider:       new DefaultSafetyProvider(),
    logger:               new ConsoleAgentLogger(),
  })
}

export async function runMockTask(query: string): Promise<AgentRunResult> {
  const runtime = buildMockRuntime()

  const task: AgentTask = {
    id:          `task-${Date.now()}`,
    type:        routeTask(query),
    query,
    parameters:  {},
    requestedBy: 'mock-test',
    createdAt:   new Date().toISOString(),
  }

  return runtime.run(task)
}

// Re-export public surface for external consumption
export { AgentRuntime }             from './runtime'
export { createExecutionPlan }      from './planner'
export { routeTask }                from './task-router'
export { ContextLoader }            from './context-loader'
export { Execution }                from './execution'
export { Reflection }               from './reflection'
export { MockReasoningEngine }      from './reasoning-engine'
export { DefaultSafetyProvider }    from './safety'
export { ConsoleAgentLogger }       from './logger'
export * from './mock-providers'
export * from './types'
export * from './interfaces'
export * from './config'
