# Agent Execution

**Files:** `execution.ts`, `execution-tools.ts`

## Principle

Execution runs an already-created `ExecutionPlan` against an already-loaded
`AgentContext`. It does not fetch data itself (that already happened in
Context Loading) — its job is to enforce Safety checks and resolve each step
to its `ExecutionTool` via the `ExecutionToolRegistry`, then invoke it.

**Phase 12 change:** Execution.ts no longer contains a `switch(step.kind)`
dispatch. All step-specific logic lives in individual `ExecutionTool`
implementations (`execution-tools.ts`). Execution's only remaining
responsibilities are: safety-checking, tool resolution, timing, and error
bookkeeping — a genuine Single Responsibility, not a mixed bag of dispatch
+ business logic.

## Tool Registry — One Tool Per Step Kind

| Step kind | Tool class | What it does |
|-----------|------------|----------------|
| `LOAD_OBSERVATIONS` | `LoadObservationsTool` | Returns `{ count: context.observations.length }` |
| `LOAD_SIGNALS` | `LoadSignalsTool` | Returns `{ count: context.signals.length }` |
| `LOAD_GRAPH` | `LoadGraphTool` | Returns `{ count: context.graphNodes.length }` |
| `LOAD_MEMORY` | `LoadMemoryTool` | Returns `{ count: context.memoryEntries.length }` |
| `LOAD_ENTITY` | `LoadEntityTool` | Returns `{ count: context.entities.length }` |
| `REASON` | `ReasonTool` | Calls `reasoningEngine.reason({ task, context })` — the only tool that invokes reasoning logic |
| `GENERATE_REPORT` | `ReportExecutionTool` | Formats the prior `REASON` step's result into a report shape — **moved out of Execution.ts** (Phase 12 fix, was previously embedded inline) |

`DefaultExecutionToolRegistry` holds these in a `Map<ExecutionStepKind, ExecutionTool>`.
`buildDefaultExecutionToolRegistry()` constructs and registers all 7 at
`Execution`'s construction time.

## Fail-Closed Dispatch — Two Independent Layers

**Layer 1 — Safety.** `STEP_TO_ACTION` is typed as
`Record<ExecutionStepKind, AgentAction>` — a *total* mapping enforced by
TypeScript at compile time. `safetyProvider.checkAction(action)` is called
for every step, unconditionally.

**Layer 2 — Tool Registry.** After Safety allows a step,
`toolRegistry.getTool(step.kind)` is called. If no tool is registered for
that kind, it throws `UnknownExecutionStepKind` rather than silently
succeeding or returning a no-op. This exception is caught by Execution's
error handling and recorded as a failed step — never treated as success.

**Why two layers:** Prior to Phase 12, an unmapped step kind fell through to
`{ allowed: true }` — a fail-open bug (Audit Finding D-1, Critical). Now,
either layer alone would prevent that regression; having both means a defect
in one does not silently reopen the vulnerability.

```
LOAD_OBSERVATIONS → READ_OBSERVATIONS
LOAD_SIGNALS      → READ_SIGNALS
LOAD_GRAPH        → READ_GRAPH
LOAD_MEMORY       → READ_MEMORY
LOAD_ENTITY       → READ_ENTITY
REASON            → CALL_TOOL
GENERATE_REPORT   → GENERATE_REPORT
```

If `checkAction()` returns `{ allowed: false, reason }`, Execution:
1. Logs the block via `logger.error('SAFETY', ...)`
2. Records a failed `ExecutionStepResult` with the safety reason as the error
3. If the step was `required: true`, marks the overall execution as failed
4. **Continues to the next step** — a single blocked optional step does not
   abort the whole plan; only a blocked *required* step marks failure.

## Error Handling

Every step runs inside a try/catch. Both a thrown tool error AND a thrown
`UnknownExecutionStepKind` are caught by the same block:
- Logged via `logger.error('EXECUTION', ...)`, with an extra note when the
  cause was an unknown step kind
- Produces a failed `ExecutionStepResult` with the error message
- Marks overall failure only if the step was `required: true`

This means optional steps (e.g. `LOAD_GRAPH` in an `INVESTIGATION` task) can
fail without derailing the entire task — the agent proceeds with whatever
evidence it does have, and the resulting gap is still visible via
`context.gaps` and the Reflection's lessons.

## Output Shape

```typescript
ExecutionResult {
  taskId, planId,
  stepResults: ExecutionStepResult[],  // one per plan step, in order
  reasoning:   ReasoningResult | null, // populated only if a REASON step ran successfully
  success:     boolean,                // false if any REQUIRED step failed
  startedAt, completedAt,
}
```

## Adding a New ExecutionStepKind (Open/Closed Principle)

1. Add the new kind to `ExecutionStepKind` in `types.ts`
2. Add its `AgentAction` mapping to `STEP_TO_ACTION` in `execution.ts`
   (TypeScript will refuse to compile if this is omitted, since the Record
   type is total)
3. Implement a new `ExecutionTool` for it in `execution-tools.ts` (or a new
   file)
4. Register it in `buildDefaultExecutionToolRegistry()`
5. If the action is a write action, add it to the Safety Layer's allow-list
   logic (see `AGENT_SAFETY.md`)

**`Execution.ts`'s `run()` method itself is never modified to add a new step
kind** — this is the Open/Closed Principle in practice: the class is closed
for modification, open for extension via new tools.
