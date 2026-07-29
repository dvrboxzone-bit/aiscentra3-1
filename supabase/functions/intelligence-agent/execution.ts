/**
 * AIscentra — Intelligence Agent Runtime: Execution
 *
 * Runs an ExecutionPlan against an already-loaded AgentContext. Every step
 * is checked against the SafetyProvider before running. Steps of kind REASON
 * invoke the ReasoningEngine; all LOAD_* steps are informational (their data
 * is already in context by the time Execution runs — Execution's job for
 * LOAD_* steps is to confirm the data landed, not to fetch it again).
 *
 * Dependency Inversion: Execution knows nothing about Supabase. It only
 * knows about the ReasoningEngine and SafetyProvider interfaces.
 */
import type { ReasoningEngine, SafetyProvider, AgentLogger } from './interfaces'
import type {
  AgentContext,
  AgentTask,
  ExecutionPlan,
  ExecutionResult,
  ExecutionStepResult,
  AgentAction,
} from './types'

export interface ExecutionDeps {
  reasoningEngine: ReasoningEngine
  safetyProvider:  SafetyProvider
  logger:          AgentLogger
}

// Maps ExecutionStep.kind to the AgentAction the Safety Layer should check.
const STEP_TO_ACTION: Record<string, AgentAction> = {
  LOAD_OBSERVATIONS: 'READ_OBSERVATIONS',
  LOAD_SIGNALS:       'READ_SIGNALS',
  LOAD_GRAPH:         'READ_GRAPH',
  LOAD_MEMORY:        'READ_MEMORY',
  LOAD_ENTITY:        'READ_ENTITY',
  REASON:             'CALL_TOOL',
  GENERATE_REPORT:    'GENERATE_REPORT',
}

export class Execution {
  constructor(private readonly deps: ExecutionDeps) {}

  async run(task: AgentTask, plan: ExecutionPlan, context: AgentContext): Promise<ExecutionResult> {
    const { reasoningEngine, safetyProvider, logger } = this.deps
    const startedAt = new Date().toISOString()
    const stepResults: ExecutionStepResult[] = []
    let reasoning: ExecutionResult['reasoning'] = null
    let overallSuccess = true

    for (const step of plan.steps) {
      const stepStart = Date.now()
      const action = STEP_TO_ACTION[step.kind]

      // ── Safety check before every step ────────────────────────────────────
      const safetyCheck = action ? safetyProvider.checkAction(action) : { allowed: true, reason: null }
      if (!safetyCheck.allowed) {
        logger.error('SAFETY', `Step '${step.kind}' blocked: ${safetyCheck.reason}`)
        stepResults.push({
          step,
          success:    false,
          output:     null,
          error:      safetyCheck.reason,
          durationMs: Date.now() - stepStart,
        })
        if (step.required) overallSuccess = false
        continue
      }

      try {
        let output: unknown = null

        switch (step.kind) {
          case 'LOAD_OBSERVATIONS':
            output = { count: context.observations.length }
            break
          case 'LOAD_SIGNALS':
            output = { count: context.signals.length }
            break
          case 'LOAD_GRAPH':
            output = { count: context.graphNodes.length }
            break
          case 'LOAD_MEMORY':
            output = { count: context.memoryEntries.length }
            break
          case 'LOAD_ENTITY':
            output = { count: context.entities.length }
            break
          case 'REASON':
            reasoning = await reasoningEngine.reason({ task, context })
            output = reasoning
            break
          case 'GENERATE_REPORT':
            output = {
              reportGenerated: reasoning !== null,
              summary:         reasoning?.summary ?? 'No reasoning result available to generate a report from.',
            }
            break
        }

        stepResults.push({
          step,
          success:    true,
          output,
          error:      null,
          durationMs: Date.now() - stepStart,
        })
        logger.log('EXECUTION', `Step '${step.kind}' completed`, { durationMs: Date.now() - stepStart })

      } catch (err) {
        logger.error('EXECUTION', `Step '${step.kind}' failed`, err)
        stepResults.push({
          step,
          success:    false,
          output:     null,
          error:      err instanceof Error ? err.message : String(err),
          durationMs: Date.now() - stepStart,
        })
        if (step.required) overallSuccess = false
      }
    }

    return {
      taskId:      task.id,
      planId:      plan.taskId,
      stepResults,
      reasoning,
      success:     overallSuccess,
      startedAt,
      completedAt: new Date().toISOString(),
    }
  }
}
