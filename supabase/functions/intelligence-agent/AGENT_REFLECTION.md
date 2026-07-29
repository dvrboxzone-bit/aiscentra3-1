# Agent Reflection

**File:** `reflection.ts`

## Principle

Reflection runs automatically after every Execution completes — success or
failure. It produces a structured self-assessment (`AgentReflection`) derived
entirely from the `ExecutionResult`. Like the Planner, Reflection is fully
deterministic: no LLM call, no randomness.

## Output Shape

```typescript
AgentReflection {
  taskId:      string
  success:     boolean
  failure:     string | null   // populated only if success === false
  confidence:  number          // taken directly from ReasoningResult.confidence
  durationMs:  number          // wall-clock time from execution start to end
  lessons:     string[]        // what went wrong or was notably weak
  nextActions: string[]        // suggested follow-up, if any
  reflectedAt: string
}
```

## How `lessons` Are Derived

1. **Failed steps** — one lesson per failed `ExecutionStepResult`, quoting
   the step kind and its error message.
2. **Low reasoning confidence** — if `ReasoningResult.confidence < 5`, a
   lesson notes the evidence base may be too thin.
3. **Gaps identified** — if `gapsIdentified.length > 0`, a lesson notes how
   many gaps were found in available evidence.
4. **Missing reasoning entirely** — if no `REASON` step ran (or it failed
   silently upstream), a lesson flags that no reasoning result was produced.

## How `nextActions` Are Derived

- Low confidence → suggests expanding retrieval scope before re-running
- Gaps present → suggests re-running once more Observatory data accumulates
- Clean success with no failures → explicitly states no follow-up is needed
  (this is intentional — Reflection should not manufacture busywork when a
  task genuinely completed well)

## Why This Matters for a Future Autonomous Agent

Reflection is the mechanism by which a genuinely autonomous agent (in a later
phase) could decide whether to retry, escalate, or simply report a result "as
is." Even in this mock phase, building Reflection as a first-class, always-run
step (rather than an optional add-on) establishes the pattern: **every task
run produces a self-assessment**, not just a result. This is what
distinguishes an intelligence agent from a stateless query-response tool.

## Relationship to Signal Engine's Own Self-Review Concept

This mirrors, at the agent level, a similar principle already established for
Signal Engine's future Self-Review stage (referenced in earlier project
discussions): after producing output, the system should ask itself whether
that output was actually good, not merely whether it ran without throwing an
exception. Reflection is that check for the Agent Runtime.

## What Remains

Reflection currently only *produces* lessons and next actions — it does not
*act* on them. A future capability (not in scope for Phase 11) would allow
the Runtime to automatically re-plan or retry based on `nextActions`, subject
to the Safety Layer and any retry-budget limits. This is explicitly deferred
— Phase 11's Definition of Done requires only that Reflection runs and
produces correct output, not that the agent self-corrects autonomously.
