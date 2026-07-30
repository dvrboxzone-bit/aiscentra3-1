/**
 * AIscentra — Intelligence Agent Runtime: Provider Interfaces
 *
 * Dependency Inversion boundary. Planner, Reasoning, Execution, and
 * Reflection depend ONLY on these interfaces — never on Supabase, Groq,
 * or any concrete data source.
 *
 * Concrete implementations (SupabaseObservationProvider, GroqReasoningEngine,
 * etc.) are written later and satisfy these contracts without requiring any
 * change to the modules that consume them.
 */
import type {
  ObservationContextItem,
  SignalContextItem,
  GraphContextItem,
  MemoryContextItem,
  EntityContextItem,
  ReasoningInput,
  ReasoningResult,
  ExecutionStep,
  AgentAction,
  SafetyCheckResult,
  AgentTask,
  AgentContext,
} from './types'

// ── Observation Provider ──────────────────────────────────────────────────────

export interface ObservationProvider {
  getRecent(limit: number): Promise<ObservationContextItem[]>
  getByEntity(entityName: string, limit: number): Promise<ObservationContextItem[]>
  getById(id: string): Promise<ObservationContextItem | null>
}

// ── Signal Provider ───────────────────────────────────────────────────────────

export interface SignalProvider {
  getRecent(limit: number): Promise<SignalContextItem[]>
  getByCategory(category: string, limit: number): Promise<SignalContextItem[]>
  getByEntity(entityName: string, limit: number): Promise<SignalContextItem[]>
  getById(id: string): Promise<SignalContextItem | null>
}

// ── Memory Provider ───────────────────────────────────────────────────────────
// Will connect to strategic_memory table (Phase 2 per Signal Engine V2 spec).
// Read-only in this phase — write operations are defined but not yet wired.

export interface MemoryProvider {
  getRelevant(topic: string, limit: number): Promise<MemoryContextItem[]>
  getByEntity(entityName: string, limit: number): Promise<MemoryContextItem[]>
  write(entry: Omit<MemoryContextItem, 'id'>): Promise<MemoryContextItem>
}

// ── Graph Provider ────────────────────────────────────────────────────────────
// Will connect to knowledge_graph_nodes / intelligence_graph / entity_registry.

export interface GraphProvider {
  getNode(nodeId: string): Promise<GraphContextItem | null>
  getNodesByType(nodeType: string, limit: number): Promise<GraphContextItem[]>
  getRelated(nodeId: string, relationType?: string): Promise<GraphContextItem[]>
  getEntity(canonicalName: string): Promise<EntityContextItem | null>
  searchEntities(query: string, limit: number): Promise<EntityContextItem[]>
}

// ── Reasoning Engine ──────────────────────────────────────────────────────────
// Concrete implementation will call an LLM. This phase uses MockReasoningEngine
// only — no LLM calls permitted until Signal Engine integration is authorized.

export interface ReasoningEngine {
  reason(input: ReasoningInput): Promise<ReasoningResult>
}

// ── Execution Tool ────────────────────────────────────────────────────────────
// One ExecutionTool per ExecutionStepKind. Execution.ts resolves the tool via
// ExecutionToolRegistry and calls Tool.execute() — it contains NO switch/case
// dispatch logic of its own. Adding a new ExecutionStepKind means adding a new
// ExecutionTool + registering it — Execution.ts itself is never modified
// (Open/Closed Principle).

export interface ExecutionToolContext {
  task: AgentTask
  context: AgentContext
}

export interface ExecutionTool {
  readonly kind: ExecutionStep['kind']
  execute(step: ExecutionStep, ctx: ExecutionToolContext): Promise<unknown>
}

// ── Execution Tool Registry ───────────────────────────────────────────────────
// Fail-closed lookup: getTool() throws UnknownExecutionStepKind if no tool is
// registered for the requested kind. There is no default/fallback tool.

export interface ExecutionToolRegistry {
  register(tool: ExecutionTool): void
  getTool(kind: ExecutionStep['kind']): ExecutionTool // throws UnknownExecutionStepKind if absent
  hasTool(kind: ExecutionStep['kind']): boolean
}

// ── Safety Layer ──────────────────────────────────────────────────────────────

export interface SafetyProvider {
  checkAction(action: AgentAction, context?: Record<string, unknown>): SafetyCheckResult
}

// ── Logger ────────────────────────────────────────────────────────────────────

export type LogStage =
  | 'TASK'
  | 'PLANNER'
  | 'CONTEXT_LOADER'
  | 'REASONING'
  | 'EXECUTION'
  | 'REFLECTION'
  | 'SAFETY'

export interface AgentLogger {
  log(stage: LogStage, message: string, data?: Record<string, unknown>): void
  error(stage: LogStage, message: string, error?: unknown): void
}
