/**
 * AIscentra — Intelligence Agent Runtime: Orchestrator
 *
 * Wires together Planner → Context Loader → Execution → Reflection.
 * This is the single entry point for running an agent task end-to-end.
 *
 * Pipeline:
 *   Task → Planner → Context Loader → (Memory/Graph feed into context) →
 *   Execution (dispatches REASON to Reasoning Engine) → Reflection → Finish
 *
 * All dependencies are injected — this class has zero knowledge of Supabase,
 * Groq, or any concrete provider. Swapping mock providers for real ones
 * requires zero changes here.
 */
import { createExecutionPlan } from './planner'
import { ContextLoader, type ContextLoaderDeps } from './context-loader'
import { Execution } from './execution'
import { Reflection } from './reflection'
import type { ReasoningEngine, SafetyProvider, AgentLogger } from './interfaces'
import type { AgentTask, AgentRunResult } from './types'

export interface AgentRuntimeDeps extends ContextLoaderDeps {
  reasoningEngine: ReasoningEngine
  safetyProvider:  SafetyProvider
  logger:          AgentLogger
}

export class AgentRuntime {
  private readonly contextLoader: ContextLoader
  private readonly execution:     Execution
  private readonly reflection:    Reflection
  private readonly logger:        AgentLogger

  constructor(private readonly deps: AgentRuntimeDeps) {
    this.logger = deps.logger
    this.contextLoader = new ContextLoader(deps)
    this.execution      = new Execution({
      reasoningEngine: deps.reasoningEngine,
      safetyProvider:  deps.safetyProvider,
      logger:          deps.logger,
    })
    this.reflection = new Reflection({ logger: deps.logger })
  }

  async run(task: AgentTask): Promise<AgentRunResult> {
    this.logger.log('TASK', `Starting task ${task.id}: "${task.query}"`, { type: task.type })

    // ── Planner ─────────────────────────────────────────────────────────────
    const plan = createExecutionPlan(task)
    this.logger.log('PLANNER', `Plan created for task type ${plan.taskType}`, { steps: plan.steps.length })

    // ── Context Loader ────────────────────────────────────────────────────────
    const context = await this.contextLoader.load(task, plan)
    this.logger.log('CONTEXT_LOADER', 'Context assembled', {
      observations: context.observations.length,
      signals:      context.signals.length,
      gaps:         context.gaps.length,
    })

    // ── Execution (includes Reasoning dispatch) ──────────────────────────────
    const execution = await this.execution.run(task, plan, context)
    this.logger.log('EXECUTION', `Execution ${execution.success ? 'succeeded' : 'failed'}`)

    // ── Reflection ────────────────────────────────────────────────────────────
    const reflection = this.reflection.reflect(execution)

    this.logger.log('TASK', `Task ${task.id} finished`, {
      success:    reflection.success,
      confidence: reflection.confidence,
      durationMs: reflection.durationMs,
    })

    return { task, plan, context, execution, reflection }
  }
}
