# Agent Context Loading

**File:** `context-loader.ts`

## Principle

The Context Loader assembles the evidence base (`AgentContext`) that
Reasoning will operate on. It reads **only** through provider interfaces —
`ObservationProvider`, `SignalProvider`, `GraphProvider`, `MemoryProvider` —
never directly from Supabase or any concrete source.

## What It Loads

Based on which `ExecutionStepKind` values appear in the `ExecutionPlan`, the
Context Loader conditionally loads:

| Plan contains | Loader calls | Populates |
|----------------|--------------|-----------|
| `LOAD_OBSERVATIONS` | `observationProvider.getRecent()` | `context.observations` |
| `LOAD_SIGNALS` | `signalProvider.getRecent()` | `context.signals` |
| `LOAD_GRAPH` | `graphProvider.getNodesByType('signal', ...)` | `context.graphNodes` |
| `LOAD_MEMORY` | `memoryProvider.getRelevant(task.query, ...)` | `context.memoryEntries` |
| `LOAD_ENTITY` | `graphProvider.searchEntities(...)` | `context.entities` |

Steps not present in the plan are simply skipped — a `SUMMARY` task's plan
has no `LOAD_GRAPH` step, so `context.graphNodes` stays empty for that task.

## Gap Tracking — Explicit, Not Hidden

Every load operation that returns empty, or throws an error, appends a
human-readable string to `context.gaps`. This mirrors the Signal Engine V2
philosophy of never silently hiding missing evidence.

Examples of gaps the loader can produce:
- `"Observations could not be loaded — observation provider error"`
- `"No prior strategic memory found for this topic — Strategic Memory is Phase 2, not yet populated"`
- `"No canonical entity found matching \"OpenAI Inc\""`

Downstream, `MockReasoningEngine` (and any future real reasoning engine)
converts each gap into a `GAP`-tagged claim in the `ReasoningResult` — so gaps
are never lost between loading and final output.

## Why Interfaces Only

If `context-loader.ts` called `supabase.from('observations').select(...)`
directly, every future change to the database schema, RLS policy, or
provider (e.g. adding a caching layer) would require touching this file.

By depending only on `ObservationProvider` (an interface), the Context
Loader is completely insulated from those changes. A
`SupabaseObservationProvider` can be swapped in — or replaced with a cached,
rate-limited, or entirely different backend — without any change here.

## Loading Limits

Configured in `config.ts` (`AGENT_CONFIG`):

```
MAX_OBSERVATIONS_PER_LOAD: 20
MAX_SIGNALS_PER_LOAD:      15
MAX_GRAPH_NODES_PER_LOAD:  10
MAX_MEMORY_ENTRIES:        5
MAX_ENTITIES_PER_LOAD:     10
```

These are intentionally conservative given the Observatory's current data
volume (dozens of signals, not thousands). They should be revisited once
real signal volume and Assistant/Agent usage patterns are better understood
— this is explicitly flagged as a scaling consideration in
`SIGNAL_ENGINE_V2_ACCEPTANCE.md`'s broader context.
