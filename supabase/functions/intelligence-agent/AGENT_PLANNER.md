# Agent Planner

**File:** `planner.ts` + `task-router.ts`

## Principle

The Planner is **fully deterministic**. It contains no LLM call, no
probabilistic reasoning, and no external I/O. Given the same Task, it always
produces the same `steps` sequence — the same step kinds, in the same order,
with the same `required`/`description`/`parameters` values.

The one exception is `ExecutionPlan.createdAt`, which is set via
`new Date().toISOString()` at plan-creation time. This means two calls to
`createExecutionPlan()` with an identical `Task` produce `ExecutionPlan`
objects that are equal in every field except `createdAt` — the plan is not
byte-for-byte identical across calls, only its step sequence is.

## Two-Stage Process

### Stage 1 — Task Routing (`task-router.ts`)

`routeTask(query: string): TaskType` classifies a natural-language query into
one of 7 types using regex pattern matching:

| TaskType | Example trigger phrases |
|----------|--------------------------|
| `COMPARE` | "compare", "versus", "vs", "difference between" |
| `TIMELINE` | "timeline", "history of", "evolution of" |
| `TREND` | "trend", "emerging pattern", "what's happening in" |
| `MONITORING` | "monitor", "watch", "alert me", "notify when" |
| `SUMMARY` | "summarize", "digest", "recap", "catch me up" |
| `ENTITY` | "profile", "tell me about", "who is", "what is" |
| `INVESTIGATION` | "investigate", "deep-dive", "analyze" (also the fallback default) |

If no pattern matches, the task defaults to `INVESTIGATION` — the broadest,
most general-purpose pipeline.

### Stage 2 — Plan Generation (`planner.ts`)

`createExecutionPlan(task: AgentTask): ExecutionPlan` looks up the TaskType in
a static `TASK_PIPELINES` map and returns a deep copy of the corresponding
step sequence.

## Example: "Investigate OpenAI"

```
routeTask("Investigate OpenAI") → 'INVESTIGATION'
    ↓
TASK_PIPELINES.INVESTIGATION →
  1. LOAD_OBSERVATIONS  (required)
  2. LOAD_SIGNALS       (required)
  3. LOAD_GRAPH         (optional)
  4. LOAD_MEMORY        (optional)
  5. REASON             (required)
  6. GENERATE_REPORT    (required)
```

## Why No LLM Here

Using an LLM to decide "what steps should I take" introduces:
- Non-determinism in a component that should always behave predictably
- Unnecessary latency and cost for a decision that has a small, enumerable
  set of correct answers
- A harder-to-audit system — "why did the agent choose these steps?" should
  always have the answer "because TaskType X always produces this plan,"
  not "because the LLM decided so this time."

The LLM's role (once wired in) is reasoning over the ASSEMBLED evidence
(`REASON` step) — not deciding what evidence to assemble.

## Extending the Planner

To add a new step to an existing TaskType's pipeline, edit the corresponding
array in `TASK_PIPELINES`. To add a new TaskType entirely:

1. Add the new value to the `TaskType` union in `types.ts`
2. Add its trigger patterns to `TASK_TYPE_PATTERNS` in `task-router.ts`
3. Add its pipeline to `TASK_PIPELINES` in `planner.ts`

No other file requires modification — `context-loader.ts` and `execution.ts`
already handle any combination of `ExecutionStepKind` values generically.
