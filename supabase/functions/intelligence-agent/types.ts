/**
 * AIscentra — Intelligence Agent Runtime: Core Types
 *
 * Zero dependency on Supabase, Groq, or any concrete infrastructure.
 * Every downstream module (Planner, Reasoning, Execution, Reflection)
 * depends only on these interfaces — never on a concrete implementation.
 *
 * This file is the contract. Concrete providers (Supabase-backed,
 * Groq-backed, etc.) implement these interfaces later, without any
 * change required here or in the modules that consume them.
 */

// ── Task ──────────────────────────────────────────────────────────────────────

export type TaskType =
  | 'INVESTIGATION'  // deep-dive into an entity, technology, or event
  | 'SUMMARY'        // condense recent signals into a digest
  | 'COMPARE'        // compare two or more entities/technologies/signals
  | 'TREND'          // identify emerging patterns across observations
  | 'ENTITY'         // profile a single canonical entity
  | 'TIMELINE'       // chronological reconstruction of events
  | 'MONITORING'      // ongoing watch for changes on a topic/entity

export interface AgentTask {
  id:          string
  type:        TaskType
  query:       string                    // natural-language task description
  parameters:  Record<string, unknown>   // task-type-specific parameters
  requestedBy: string                    // user id or 'system'
  createdAt:   string                    // ISO timestamp
}

// ── Execution Plan ────────────────────────────────────────────────────────────
// Produced by the Planner. Fully deterministic — no LLM involvement.

export type ExecutionStepKind =
  | 'LOAD_OBSERVATIONS'
  | 'LOAD_SIGNALS'
  | 'LOAD_GRAPH'
  | 'LOAD_MEMORY'
  | 'LOAD_ENTITY'
  | 'REASON'
  | 'GENERATE_REPORT'

export interface ExecutionStep {
  kind:         ExecutionStepKind
  description:  string                  // human-readable purpose of this step
  required:     boolean                 // if false, failure does not abort the plan
  parameters:   Record<string, unknown>
}

export interface ExecutionPlan {
  taskId:  string
  taskType:TaskType
  steps:   ExecutionStep[]
  createdAt: string
}

// ── Context ───────────────────────────────────────────────────────────────────
// The assembled evidence base a task's reasoning step will operate on.

export interface AgentContext {
  taskId:        string
  observations:  ObservationContextItem[]
  signals:       SignalContextItem[]
  graphNodes:    GraphContextItem[]
  memoryEntries: MemoryContextItem[]
  entities:      EntityContextItem[]
  loadedAt:      string
  gaps:          string[]   // what the loader could not find — explicit, not hidden
}

export interface ObservationContextItem {
  id:          string
  title:       string
  summary:     string
  sourceName:  string
  collectedAt: string
}

export interface SignalContextItem {
  id:              string
  title:           string
  description:     string
  category:        string
  signalScore:     number
  intelligenceType:string
  createdAt:       string
}

export interface GraphContextItem {
  id:          string
  nodeType:    string
  label:       string
  description: string | null
  importance:  number | null
}

export interface MemoryContextItem {
  id:           string
  memoryType:   string
  title:        string
  summary:      string
  confidence:   number
}

export interface EntityContextItem {
  id:            string
  canonicalName: string
  entityType:    string
  description:   string | null
}

// ── Reasoning ─────────────────────────────────────────────────────────────────

export interface ReasoningInput {
  task:    AgentTask
  context: AgentContext
}

export type ClaimType = 'FACT' | 'INFERENCE' | 'GAP' | 'HYPOTHESIS'

export interface ReasoningClaim {
  type:       ClaimType
  statement:  string
  evidenceIds:string[]   // observation/signal/graph/memory IDs supporting this claim
  confidence: number      // 0-10
}

export interface ReasoningResult {
  taskId:        string
  summary:       string
  claims:        ReasoningClaim[]
  gapsIdentified:string[]
  confidence:    number   // overall confidence 0-10
  reasonedAt:    string
}

// ── Execution ─────────────────────────────────────────────────────────────────

export interface ExecutionStepResult {
  step:      ExecutionStep
  success:   boolean
  output:    unknown
  error:     string | null
  durationMs:number
}

export interface ExecutionResult {
  taskId:      string
  planId:      string
  stepResults: ExecutionStepResult[]
  reasoning:   ReasoningResult | null
  success:     boolean
  startedAt:   string
  completedAt: string
}

// ── Reflection ────────────────────────────────────────────────────────────────

export interface AgentReflection {
  taskId:      string
  success:     boolean
  failure:     string | null
  confidence:  number
  durationMs:  number
  lessons:     string[]
  nextActions: string[]
  reflectedAt: string
}

// ── Safety ────────────────────────────────────────────────────────────────────

export type AgentAction =
  | 'READ_OBSERVATIONS'
  | 'READ_SIGNALS'
  | 'READ_GRAPH'
  | 'READ_MEMORY'
  | 'READ_ENTITY'
  | 'WRITE_MEMORY'
  | 'WRITE_GRAPH'
  | 'WRITE_SIGNAL'
  | 'CALL_TOOL'
  | 'GENERATE_REPORT'

export interface SafetyCheckResult {
  allowed: boolean
  reason:  string | null
}

// ── Final result ──────────────────────────────────────────────────────────────

export interface AgentRunResult {
  task:       AgentTask
  plan:       ExecutionPlan
  context:    AgentContext
  execution:  ExecutionResult
  reflection: AgentReflection
}

// ── Errors ────────────────────────────────────────────────────────────────────
// Fail-closed error types. Thrown, never silently swallowed into a default-allow.

export class UnknownExecutionStepKind extends Error {
  constructor(public readonly stepKind: string) {
    super(`Unknown ExecutionStepKind: '${stepKind}'. No ExecutionTool is registered for this step. Execution refuses to proceed (fail-closed).`)
    this.name = 'UnknownExecutionStepKind'
  }
}
