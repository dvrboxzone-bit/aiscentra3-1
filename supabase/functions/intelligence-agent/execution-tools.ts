/**
 * AIscentra — Intelligence Agent Runtime: Execution Tools + Registry
 *
 * Fixes Phase 12 Audit Finding D-1 (Critical) and B-1 (Major):
 * - Execution.ts no longer contains a switch(step.kind) dispatch.
 * - Every ExecutionStepKind has exactly one dedicated ExecutionTool.
 * - DefaultExecutionToolRegistry.getTool() throws UnknownExecutionStepKind
 *   for any kind without a registered tool — fail-closed, no default-allow.
 *
 * Adding a new ExecutionStepKind requires:
 *   1. Add the kind to ExecutionStepKind (types.ts)
 *   2. Implement a new ExecutionTool for it (this file, or a new file)
 *   3. Register it via registry.register(new YourTool())
 * Execution.ts itself is never modified — Open/Closed Principle upheld.
 */
import type { ExecutionTool, ExecutionToolContext, ExecutionToolRegistry } from './interfaces'
import type { ExecutionStep } from './types'
import { UnknownExecutionStepKind } from './types'

// ── Registry ──────────────────────────────────────────────────────────────────

export class DefaultExecutionToolRegistry implements ExecutionToolRegistry {
  private readonly tools = new Map<ExecutionStep['kind'], ExecutionTool>()

  register(tool: ExecutionTool): void {
    this.tools.set(tool.kind, tool)
  }

  hasTool(kind: ExecutionStep['kind']): boolean {
    return this.tools.has(kind)
  }

  getTool(kind: ExecutionStep['kind']): ExecutionTool {
    const tool = this.tools.get(kind)
    if (!tool) {
      // Fail-closed: no default tool, no default-allow. Throws, always.
      throw new UnknownExecutionStepKind(kind)
    }
    return tool
  }
}

// ── LOAD_OBSERVATIONS ─────────────────────────────────────────────────────────

export class LoadObservationsTool implements ExecutionTool {
  readonly kind = 'LOAD_OBSERVATIONS' as const

  async execute(_step: ExecutionStep, ctx: ExecutionToolContext): Promise<unknown> {
    return { count: ctx.context.observations.length }
  }
}

// ── LOAD_SIGNALS ──────────────────────────────────────────────────────────────

export class LoadSignalsTool implements ExecutionTool {
  readonly kind = 'LOAD_SIGNALS' as const

  async execute(_step: ExecutionStep, ctx: ExecutionToolContext): Promise<unknown> {
    return { count: ctx.context.signals.length }
  }
}

// ── LOAD_GRAPH ────────────────────────────────────────────────────────────────

export class LoadGraphTool implements ExecutionTool {
  readonly kind = 'LOAD_GRAPH' as const

  async execute(_step: ExecutionStep, ctx: ExecutionToolContext): Promise<unknown> {
    return { count: ctx.context.graphNodes.length }
  }
}

// ── LOAD_MEMORY ───────────────────────────────────────────────────────────────

export class LoadMemoryTool implements ExecutionTool {
  readonly kind = 'LOAD_MEMORY' as const

  async execute(_step: ExecutionStep, ctx: ExecutionToolContext): Promise<unknown> {
    return { count: ctx.context.memoryEntries.length }
  }
}

// ── LOAD_ENTITY ───────────────────────────────────────────────────────────────

export class LoadEntityTool implements ExecutionTool {
  readonly kind = 'LOAD_ENTITY' as const

  async execute(_step: ExecutionStep, ctx: ExecutionToolContext): Promise<unknown> {
    return { count: ctx.context.entities.length }
  }
}

// ── REASON ────────────────────────────────────────────────────────────────────
// The only tool that calls out to a ReasoningEngine. The engine is injected
// at construction time — this tool has no knowledge of Groq, Supabase, or
// any concrete reasoning implementation, only the ReasoningEngine interface.

export class ReasonTool implements ExecutionTool {
  readonly kind = 'REASON' as const

  constructor(private readonly reasoningEngine: import('./interfaces').ReasoningEngine) {}

  async execute(_step: ExecutionStep, ctx: ExecutionToolContext): Promise<unknown> {
    return this.reasoningEngine.reason({ task: ctx.task, context: ctx.context })
  }
}

// ── GENERATE_REPORT ───────────────────────────────────────────────────────────
// Fixes Phase 12 Audit Finding D-3 (Major): report-formatting business logic
// is now isolated in its own tool, not embedded inside Execution.ts.
//
// This tool needs the prior REASON step's output. Since Execution passes
// only (step, ctx) to tools, ReportExecutionTool receives the reasoning
// result via a small injected accessor rather than reaching into Execution's
// internals — see execution.ts for how this is wired.

export class ReportExecutionTool implements ExecutionTool {
  readonly kind = 'GENERATE_REPORT' as const

  constructor(
    private readonly getLastReasoningResult: () => import('./types').ReasoningResult | null,
  ) {}

  async execute(_step: ExecutionStep, _ctx: ExecutionToolContext): Promise<unknown> {
    const reasoning = this.getLastReasoningResult()
    return {
      reportGenerated: reasoning !== null,
      summary:         reasoning?.summary ?? 'No reasoning result available to generate a report from.',
    }
  }
}

// ── Registry factory ──────────────────────────────────────────────────────────
// Builds a registry with all 7 tools registered. REASON and GENERATE_REPORT
// require runtime dependencies (ReasoningEngine, a reasoning-result accessor)
// so this factory takes them as parameters rather than hardcoding them.

export function buildDefaultExecutionToolRegistry(deps: {
  reasoningEngine:        import('./interfaces').ReasoningEngine
  getLastReasoningResult: () => import('./types').ReasoningResult | null
}): ExecutionToolRegistry {
  const registry = new DefaultExecutionToolRegistry()

  registry.register(new LoadObservationsTool())
  registry.register(new LoadSignalsTool())
  registry.register(new LoadGraphTool())
  registry.register(new LoadMemoryTool())
  registry.register(new LoadEntityTool())
  registry.register(new ReasonTool(deps.reasoningEngine))
  registry.register(new ReportExecutionTool(deps.getLastReasoningResult))

  return registry
}
