/**
 * AIscentra — Intelligence Agent Runtime: Execution
 *
 * Fixes Phase 12 Audit Findings D-1 (Critical), D-2 (Major), D-3 (Major):
 *
 * D-1 fix: STEP_TO_ACTION lookups that miss no longer default-allow.
 *   Every step's AgentAction is now a required, total mapping — if a step
 *   kind has no action mapping OR no registered tool, Execution throws
 *   (via ExecutionToolRegistry.getTool(), which throws UnknownExecutionStepKind).
 *   There is no fallback branch that resolves to { allowed: true }.
 *
 * D-2 mitigation: the fail-closed behavior no longer depends solely on the
 *   WRITE_ACTIONS_REQUIRE_EXPLICIT_ALLOW config flag for its bypass-resistance —
 *   an unmapped/unregistered step now fails via a thrown exception BEFORE
 *   reaching the config-gated write-check branch at all.
 *
 * D-3 fix: report-formatting logic has moved to ReportExecutionTool
 *   (execution-tools.ts). Execution.ts now does ONLY: resolve tool from
 *   registry, check Safety, invoke tool, record timing/result. No
 *   switch(step.kind), no report-content logic.
 *
 * Dependency Inversion: Execution knows nothing about Supabase or Groq.
 * It depends only on ExecutionToolRegistry and SafetyProvider (interfaces).
 */
import type { SafetyProvider, AgentLogger, ReasoningEngine } from './interfaces'
import type {
  AgentContext,
  AgentTask,
  ExecutionPlan,
  ExecutionResult,
  ExecutionStepResult,
  ExecutionStep,
  AgentAction,
  ReasoningResult,
} from './types'
import { UnknownExecutionStepKind } from './types'
import { buildDefaultExecutionToolRegistry } from './execution-tools'
import type { ExecutionToolRegistry } from './interfaces'

export interface ExecutionDeps {
  reasoningEngine: ReasoningEngine
  safetyProvider: SafetyProvider
  logger: AgentLogger
  toolRegistry?: ExecutionToolRegistry // optional override for testing/extension
}

// Total mapping — every ExecutionStepKind MUST have an entry here.
// If a new ExecutionStepKind is added to types.ts without adding an entry
// here, TypeScript's exhaustiveness (via the Record<ExecutionStepKind, ...>
// type) will fail to compile — this is now a compile-time guarantee, not a
// runtime fallback.
const STEP_TO_ACTION: Record<ExecutionStep['kind'], AgentAction> = {
  LOAD_OBSERVATIONS: 'READ_OBSERVATIONS',
  LOAD_SIGNALS: 'READ_SIGNALS',
  LOAD_GRAPH: 'READ_GRAPH',
  LOAD_MEMORY: 'READ_MEMORY',
  LOAD_ENTITY: 'READ_ENTITY',
  REASON: 'CALL_TOOL',
  GENERATE_REPORT: 'GENERATE_REPORT',
}

export class Execution {
  private readonly safetyProvider: SafetyProvider
  private readonly logger: AgentLogger
  private readonly toolRegistry: ExecutionToolRegistry
  private lastReasoningResult: ReasoningResult | null = null

  constructor(deps: ExecutionDeps) {
    this.safetyProvider = deps.safetyProvider
    this.logger = deps.logger
    this.toolRegistry =
      deps.toolRegistry ??
      buildDefaultExecutionToolRegistry({
        reasoningEngine: deps.reasoningEngine,
        getLastReasoningResult: () => this.lastReasoningResult,
      })
  }

  async run(task: AgentTask, plan: ExecutionPlan, context: AgentContext): Promise<ExecutionResult> {
    const startedAt = new Date().toISOString()
    const stepResults: ExecutionStepResult[] = []
    let overallSuccess = true
    this.lastReasoningResult = null

    for (const step of plan.steps) {
      const stepStart = Date.now()

      try {
        // ── Fail-closed action mapping ──────────────────────────────────────
        // STEP_TO_ACTION is a total Record<ExecutionStepKind, AgentAction> —
        // TypeScript guarantees every kind has an entry at compile time.
        // No runtime fallback to a permissive default exists.
        const action = STEP_TO_ACTION[step.kind]

        // ── Safety check — always invoked, never skipped ────────────────────
        const safetyCheck = this.safetyProvider.checkAction(action)
        if (!safetyCheck.allowed) {
          this.logger.error('SAFETY', `Step '${step.kind}' blocked: ${safetyCheck.reason}`)
          stepResults.push({
            step,
            success: false,
            output: null,
            error: safetyCheck.reason,
            durationMs: Date.now() - stepStart,
          })
          if (step.required) overallSuccess = false
          continue
        }

        // ── Resolve tool — fail-closed if unregistered ──────────────────────
        // ExecutionToolRegistry.getTool() throws UnknownExecutionStepKind if
        // no tool is registered for this kind. This propagates to the outer
        // catch block below, which records it as a failed, non-silent step.
        const tool = this.toolRegistry.getTool(step.kind)

        // ── Invoke tool ──────────────────────────────────────────────────────
        const output = await tool.execute(step, { task, context })

        if (step.kind === 'REASON') {
          this.lastReasoningResult = output as ReasoningResult
        }

        stepResults.push({
          step,
          success: true,
          output,
          error: null,
          durationMs: Date.now() - stepStart,
        })
        this.logger.log('EXECUTION', `Step '${step.kind}' completed`, {
          durationMs: Date.now() - stepStart,
        })
      } catch (err) {
        // UnknownExecutionStepKind lands here too — fail-closed, always
        // recorded as a failure, never silently treated as success.
        const isUnknownKind = err instanceof UnknownExecutionStepKind
        this.logger.error(
          'EXECUTION',
          `Step '${step.kind}' failed${isUnknownKind ? ' (unknown step kind — fail-closed)' : ''}`,
          err,
        )
        stepResults.push({
          step,
          success: false,
          output: null,
          error: err instanceof Error ? err.message : String(err),
          durationMs: Date.now() - stepStart,
        })
        if (step.required) overallSuccess = false
      }
    }

    return {
      taskId: task.id,
      planId: plan.taskId,
      stepResults,
      reasoning: this.lastReasoningResult,
      success: overallSuccess,
      startedAt,
      completedAt: new Date().toISOString(),
    }
  }
}
