/**
 * AIscentra — Intelligence Agent Runtime: Planner
 *
 * Fully deterministic. Takes a Task, produces an ExecutionPlan.
 * NO LLM involvement — the plan shape is a pure function of TaskType.
 *
 * Example: "Investigate OpenAI" → INVESTIGATION task type →
 *   LOAD_OBSERVATIONS, LOAD_SIGNALS, LOAD_GRAPH, LOAD_MEMORY, REASON, GENERATE_REPORT
 */
import { routeTask } from './task-router'
import type { AgentTask, ExecutionPlan, ExecutionStep, TaskType } from './types'

// ── Per-TaskType pipeline shapes ──────────────────────────────────────────────
// Each entry defines the deterministic sequence of steps for that task type.

const TASK_PIPELINES: Record<TaskType, ExecutionStep[]> = {
  INVESTIGATION: [
    { kind: 'LOAD_OBSERVATIONS', description: 'Gather recent observations related to the subject', required: true,  parameters: {} },
    { kind: 'LOAD_SIGNALS',      description: 'Gather published signals related to the subject',     required: true,  parameters: {} },
    { kind: 'LOAD_GRAPH',        description: 'Traverse knowledge graph for related entities',        required: false, parameters: {} },
    { kind: 'LOAD_MEMORY',       description: 'Retrieve prior strategic conclusions on this subject',  required: false, parameters: {} },
    { kind: 'REASON',            description: 'Synthesize evidence into an analytical conclusion',    required: true,  parameters: {} },
    { kind: 'GENERATE_REPORT',   description: 'Produce final investigation report',                   required: true,  parameters: {} },
  ],
  SUMMARY: [
    { kind: 'LOAD_SIGNALS',      description: 'Gather recent signals for the summary window',         required: true,  parameters: {} },
    { kind: 'REASON',            description: 'Condense signals into a digest',                       required: true,  parameters: {} },
    { kind: 'GENERATE_REPORT',   description: 'Produce summary report',                                required: true,  parameters: {} },
  ],
  COMPARE: [
    { kind: 'LOAD_ENTITY',       description: 'Resolve each entity being compared',                    required: true,  parameters: {} },
    { kind: 'LOAD_SIGNALS',      description: 'Gather signals for each entity',                        required: true,  parameters: {} },
    { kind: 'LOAD_GRAPH',        description: 'Compare graph positions of each entity',                 required: false, parameters: {} },
    { kind: 'REASON',            description: 'Synthesize comparative analysis',                        required: true,  parameters: {} },
    { kind: 'GENERATE_REPORT',   description: 'Produce comparison report',                              required: true,  parameters: {} },
  ],
  TREND: [
    { kind: 'LOAD_OBSERVATIONS', description: 'Gather observations across the trend window',            required: true,  parameters: {} },
    { kind: 'LOAD_SIGNALS',      description: 'Gather signals across the trend window',                 required: true,  parameters: {} },
    { kind: 'LOAD_MEMORY',       description: 'Check for prior trend hypotheses',                        required: false, parameters: {} },
    { kind: 'REASON',            description: 'Identify pattern and directional evidence',               required: true,  parameters: {} },
    { kind: 'GENERATE_REPORT',   description: 'Produce trend report',                                    required: true,  parameters: {} },
  ],
  ENTITY: [
    { kind: 'LOAD_ENTITY',       description: 'Resolve canonical entity record',                        required: true,  parameters: {} },
    { kind: 'LOAD_SIGNALS',      description: 'Gather signals mentioning this entity',                   required: true,  parameters: {} },
    { kind: 'LOAD_GRAPH',        description: 'Traverse graph relationships for this entity',             required: false, parameters: {} },
    { kind: 'REASON',            description: 'Synthesize entity profile',                               required: true,  parameters: {} },
    { kind: 'GENERATE_REPORT',   description: 'Produce entity profile report',                            required: true,  parameters: {} },
  ],
  TIMELINE: [
    { kind: 'LOAD_OBSERVATIONS', description: 'Gather observations across the requested time range',    required: true,  parameters: {} },
    { kind: 'LOAD_SIGNALS',      description: 'Gather signals across the requested time range',          required: true,  parameters: {} },
    { kind: 'REASON',            description: 'Order and synthesize chronological narrative',            required: true,  parameters: {} },
    { kind: 'GENERATE_REPORT',   description: 'Produce timeline report',                                 required: true,  parameters: {} },
  ],
  MONITORING: [
    { kind: 'LOAD_ENTITY',       description: 'Resolve monitored entity/topic',                          required: true,  parameters: {} },
    { kind: 'LOAD_MEMORY',       description: 'Retrieve prior monitoring baseline',                       required: false, parameters: {} },
    { kind: 'LOAD_SIGNALS',      description: 'Check for new signals since baseline',                     required: true,  parameters: {} },
    { kind: 'REASON',            description: 'Determine if monitored condition has changed',             required: true,  parameters: {} },
    { kind: 'GENERATE_REPORT',   description: 'Produce monitoring status report',                         required: true,  parameters: {} },
  ],
}

/**
 * Produces a deterministic ExecutionPlan from a Task.
 * If task.type is not set, routes it first via routeTask().
 */
export function createExecutionPlan(task: AgentTask): ExecutionPlan {
  const taskType = task.type ?? routeTask(task.query)
  const steps    = TASK_PIPELINES[taskType]

  return {
    taskId:    task.id,
    taskType,
    steps:     steps.map(s => ({ ...s })), // defensive copy — plans are immutable once created
    createdAt: new Date().toISOString(),
  }
}
