# Agent Safety

**File:** `safety.ts`

## Principle

Every action the agent attempts is checked against the `SafetyProvider`
interface before Execution proceeds. The default implementation,
`DefaultSafetyProvider`, applies a **deny-by-default** posture for all write
operations.

## Action Categories

```typescript
type AgentAction =
  | 'READ_OBSERVATIONS'
  | 'READ_SIGNALS'
  | 'READ_GRAPH'
  | 'READ_MEMORY'
  | 'READ_ENTITY'
  | 'WRITE_MEMORY'
  | 'WRITE_GRAPH'
  | 'WRITE_SIGNAL'
  | 'CALL_TOOL'
  | 'GENERATE_REPORT'
```

## Default Posture

| Action | Default | Rationale |
|--------|---------|-----------|
| `READ_*` (5 actions) | ✅ Allowed | Read-only operations against Observatory data pose no data-integrity risk |
| `WRITE_MEMORY` | ❌ Denied unless explicitly allow-listed | Writing to Strategic Memory is a Phase 2 capability — not authorized yet |
| `WRITE_GRAPH` | ❌ Denied unless explicitly allow-listed | Modifying the Knowledge Graph is Signal Engine territory — explicitly frozen per Phase 11 instructions |
| `WRITE_SIGNAL` | ❌ Denied unless explicitly allow-listed | Creating/modifying Signals is Signal Engine's exclusive responsibility |
| `CALL_TOOL` | ✅ Allowed | Non-destructive by definition — the Reasoning step itself |
| `GENERATE_REPORT` | ✅ Allowed | Non-destructive — produces output, does not mutate stored data |

## Why Deny-by-Default for Writes

The Agent Runtime is explicitly forbidden, per Phase 11 instructions, from
modifying Signal Engine, SIS, Qualification, Decision Logic, Thresholds,
Strategic Memory schema, or Knowledge Graph schema. Deny-by-default for all
write actions is the Safety Layer's enforcement of that boundary at runtime,
not merely at code-review time.

Even once the Agent is authorized to write (e.g. to Strategic Memory in a
future phase), the `DefaultSafetyProvider` constructor requires an explicit
allow-list:

```typescript
new DefaultSafetyProvider(['WRITE_MEMORY'])  // only this write action is now allowed
```

No write action is ever allowed by omission or by a broad wildcard — each
must be named explicitly.

## What Happens When an Action Is Denied

`Execution.run()` checks every step's mapped action before dispatching it. If
denied:

1. The block is logged via `logger.error('SAFETY', ...)`
2. A failed `ExecutionStepResult` is recorded with the safety `reason` as the
   error message
3. If the step was `required: true`, overall execution is marked failed
4. Execution continues to the next step (a blocked step does not crash the
   runtime — it fails gracefully and visibly)

This means a blocked action is always visible in the final `AgentRunResult`
— in `stepResults`, and consequently reflected in `Reflection.lessons` — never
silently skipped.

## Unknown Actions

Any `AgentAction` value not matched by the above categories (which should not
occur given the current closed enum, but is handled defensively) is denied
with an explicit "unknown action" reason. This is a deliberate fail-closed
choice — an action the Safety Layer does not recognize is treated as
forbidden, never as implicitly allowed.
