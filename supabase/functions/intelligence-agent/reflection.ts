/**
 * AIscentra — Intelligence Agent Runtime: Reflection
 *
 * Runs automatically after Execution completes. Produces a structured
 * self-assessment: success/failure, confidence, duration, lessons, and
 * suggested next actions. Fully deterministic — derives everything from
 * the ExecutionResult, no LLM call.
 */
import type { AgentLogger } from './interfaces'
import type { AgentReflection, ExecutionResult } from './types'

export interface ReflectionDeps {
  logger: AgentLogger
}

export class Reflection {
  constructor(private readonly deps: ReflectionDeps) {}

  reflect(execution: ExecutionResult): AgentReflection {
    const { logger } = this.deps

    const startedMs   = new Date(execution.startedAt).getTime()
    const completedMs = new Date(execution.completedAt).getTime()
    const durationMs  = completedMs - startedMs

    const failedSteps = execution.stepResults.filter(r => !r.success)
    const lessons:     string[] = []
    const nextActions: string[] = []

    if (failedSteps.length > 0) {
      for (const failed of failedSteps) {
        lessons.push(`Step '${failed.step.kind}' failed: ${failed.error ?? 'unknown error'}`)
      }
    }

    if (execution.reasoning) {
      if (execution.reasoning.confidence < 5) {
        lessons.push('Reasoning confidence was low — evidence base may be too thin for a reliable conclusion.')
        nextActions.push('Consider expanding observation/signal retrieval scope before re-running this task.')
      }
      if (execution.reasoning.gapsIdentified.length > 0) {
        lessons.push(`${execution.reasoning.gapsIdentified.length} gap(s) identified in available evidence.`)
        nextActions.push('Gaps should be monitored — re-run this task once more Observatory data accumulates.')
      }
    } else {
      lessons.push('No reasoning result was produced — REASON step may not have run or failed.')
    }

    if (execution.success && failedSteps.length === 0) {
      nextActions.push('Task completed cleanly — no immediate follow-up required.')
    }

    const failureReason = !execution.success
      ? `${failedSteps.length} required step(s) failed: ${failedSteps.map(s => s.step.kind).join(', ')}`
      : null

    const reflection: AgentReflection = {
      taskId:      execution.taskId,
      success:     execution.success,
      failure:     failureReason,
      confidence:  execution.reasoning?.confidence ?? 0,
      durationMs,
      lessons,
      nextActions,
      reflectedAt: new Date().toISOString(),
    }

    logger.log('REFLECTION', `Task ${execution.taskId} reflection complete`, {
      success: reflection.success, confidence: reflection.confidence, durationMs,
    })

    return reflection
  }
}
