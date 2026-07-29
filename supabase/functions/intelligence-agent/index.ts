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
import { GroqReasoningEngine } from './groq-reasoning-engine'
import {
  MockObservationProvider,
  MockSignalProvider,
  MockGraphProvider,
  MockMemoryProvider,
} from './mock-providers'
import {
  SupabaseObservationProvider,
  SupabaseSignalProvider,
  SupabaseGraphProvider,
  SupabaseMemoryProvider,
} from './supabase-providers'
import { routeTask } from './task-router'
import type { AgentTask, AgentRunResult } from './types'
import type { ReasoningEngine } from './interfaces'

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

/**
 * Production runtime — real Observatory data via Supabase-backed providers,
 * real reasoning via GroqReasoningEngine. Identical wiring shape to
 * buildMockRuntime(); only the concrete provider classes differ.
 *
 * Data flow:
 *   User Task → Planner → Context Loader
 *     ├── SupabaseObservationProvider (observations table)
 *     ├── SupabaseSignalProvider      (signals table)
 *     ├── SupabaseGraphProvider       (knowledge_graph_nodes, intelligence_graph, entity_registry)
 *     └── SupabaseMemoryProvider      (empty — strategic_memory is Phase 2)
 *   → Execution → GroqReasoningEngine (via ReasonTool) → Reflection → Report
 *
 * Groq remains the only Reasoning Engine — no second LLM, no Cloudflare AI.
 * Signal Engine is read-only from this Runtime's perspective; nothing here
 * writes to signals, observations, or any Signal Engine V2 table.
 */
export function buildProductionRuntime(): AgentRuntime {
  return new AgentRuntime({
    observationProvider: new SupabaseObservationProvider(),
    signalProvider:       new SupabaseSignalProvider(),
    graphProvider:        new SupabaseGraphProvider(),
    memoryProvider:       new SupabaseMemoryProvider(),
    reasoningEngine:      new GroqReasoningEngine(),
    safetyProvider:       new DefaultSafetyProvider(),
    logger:               new ConsoleAgentLogger(),
  })
}

/**
 * DI entry point — selects MockReasoningEngine or GroqReasoningEngine based
 * on NODE_ENV, without changing AgentRuntime, Execution, or any pipeline
 * stage. Both engines satisfy the same ReasoningEngine interface
 * (interfaces.ts:70-72) — this function only decides which concrete
 * implementation gets injected.
 *
 *   NODE_ENV=development (or unset) → MockReasoningEngine
 *   NODE_ENV=production             → GroqReasoningEngine
 */
export function buildRuntime(): AgentRuntime {
  const isProduction = process.env['NODE_ENV'] === 'production'
  return isProduction ? buildProductionRuntime() : buildMockRuntime()
}

/**
 * Constructs a ReasoningEngine directly (Mock or Groq) based on NODE_ENV.
 * Exposed for callers that want to inject a specific reasoning engine into
 * a custom AgentRuntimeDeps wiring without using buildRuntime()'s full
 * Mock-provider defaults.
 */
export function resolveReasoningEngine(): ReasoningEngine {
  const isProduction = process.env['NODE_ENV'] === 'production'
  return isProduction ? new GroqReasoningEngine() : new MockReasoningEngine()
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

/**
 * Runs a task through the environment-appropriate runtime (Mock in dev,
 * Groq in production) — the production counterpart to runMockTask().
 */
export async function runTask(query: string, requestedBy: string = 'system'): Promise<AgentRunResult> {
  const runtime = buildRuntime()

  const task: AgentTask = {
    id:          `task-${Date.now()}`,
    type:        routeTask(query),
    query,
    parameters:  {},
    requestedBy,
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
export { GroqReasoningEngine }      from './groq-reasoning-engine'
export { DefaultSafetyProvider }    from './safety'
export { ConsoleAgentLogger }       from './logger'
export * from './mock-providers'
export * from './supabase-providers'
export * from './types'
export * from './interfaces'
export * from './config'
