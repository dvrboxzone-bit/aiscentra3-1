# Agent Execution

**File:** `execution.ts`

## Principle

Execution runs an already-created `ExecutionPlan` against an already-loaded
`AgentContext`. It does not fetch data itself (that already happened in
Context Loading) — its job is to dispatch each step, enforce Safety checks,
and invoke the `ReasoningEngine` for `REASON` steps.

## Step Dispatch

Each `ExecutionStep.kind` maps to a handler:

| Step kind | What Execution does |
|-----------|----------------------|
| `LOAD_OBSERVATIONS` / `LOAD_SIGNALS` / `LOAD_GRAPH` / `LOAD_MEMORY` / `LOAD_ENTITY` | Confirms the corresponding context array is populated (data was already fetched by Context Loader) — records a count in the step output |
| `REASON` | Calls `reasoningEngine.reason({ task, context })` — this is the ONLY step that invokes reasoning logic (LLM in production, mock today) |
| `GENERATE_REPORT` | Packages the reasoning summary into a report-shaped output |

## Safety-First Dispatch

Before running ANY step, Execution maps the step's `kind` to an `AgentAction`
(via `STEP_TO_ACTION`) and calls `safetyProvider.checkAction(action)`.

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

Every step runs inside a try/catch. A thrown error:
- Is logged via `logger.error('EXECUTION', ...)`
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

## What Remains for Real Tool Calls

Currently, `LOAD_*` steps are informational only (data already loaded).
Once the agent needs to perform actual external actions — e.g. searching the
web, calling an external API, writing to `strategic_memory` — those become
new `ExecutionStepKind` values dispatched through the `ExecutionTool`
interface (defined in `interfaces.ts` but not yet implemented by any
concrete tool). Adding a tool requires:

1. Define the new `ExecutionStepKind`
2. Implement `ExecutionTool` for it
3. Add a case to Execution's switch statement (or migrate to a tool registry
   pattern if the number of tools grows significantly)
4. Add the corresponding `AgentAction` to `STEP_TO_ACTION` and to the Safety
   Layer's allow-list logic if it is a write action
