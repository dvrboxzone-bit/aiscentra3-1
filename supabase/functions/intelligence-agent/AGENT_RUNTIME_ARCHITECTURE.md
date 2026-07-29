# Agent Runtime Architecture

**Status:** Mock implementation complete. No LLM or Supabase wiring yet.
**Location:** `supabase/functions/intelligence-agent/`

## Overview

The Intelligence Agent Runtime is the execution substrate for AIscentra's
future autonomous analyst capabilities. It is built entirely on Dependency
Inversion: every module that performs reasoning, planning, or execution logic
depends only on interfaces defined in `interfaces.ts` — never on a concrete
data source.

This allows the entire pipeline to be built, tested, and verified with mock
providers before a single real Supabase query or Groq call is wired in.

## Pipeline

```
Task
  ↓
Planner              (deterministic — produces ExecutionPlan from TaskType)
  ↓
Context Loader       (reads via ObservationProvider, SignalProvider,
                       GraphProvider, MemoryProvider interfaces)
  ↓
Execution            (dispatches steps, checks Safety Layer, calls
                       ReasoningEngine for REASON steps)
  ↓
Reflection           (deterministic self-assessment of the run)
  ↓
Finish → AgentRunResult
```

## File Map

| File | Responsibility |
|------|-----------------|
| `types.ts` | All core types — Task, ExecutionPlan, AgentContext, ReasoningResult, etc. Zero dependencies. |
| `interfaces.ts` | Provider contracts — ObservationProvider, SignalProvider, GraphProvider, MemoryProvider, ReasoningEngine, ExecutionTool, SafetyProvider, AgentLogger. |
| `config.ts` | Runtime configuration — load limits, timeouts, safety defaults. |
| `logger.ts` | `ConsoleAgentLogger` — implements `AgentLogger`. |
| `safety.ts` | `DefaultSafetyProvider` — deny-by-default for write actions. |
| `task-router.ts` | `routeTask()` — deterministic TaskType classification from a query string. |
| `planner.ts` | `createExecutionPlan()` — deterministic plan generation per TaskType. |
| `context-loader.ts` | `ContextLoader` — assembles `AgentContext` via provider interfaces. |
| `reasoning-engine.ts` | `MockReasoningEngine` — produces evidence-linked claims without any LLM call. |
| `execution.ts` | `Execution` — runs plan steps through Safety Layer, dispatches REASON to ReasoningEngine. |
| `reflection.ts` | `Reflection` — deterministic post-run self-assessment. |
| `runtime.ts` | `AgentRuntime` — orchestrates the full pipeline. |
| `mock-providers.ts` | `Mock*Provider` implementations of every interface, in-memory data. |
| `index.ts` | Assembly point — `buildMockRuntime()`, `runMockTask()`, public re-exports. |

## Dependency Inversion Guarantee

`planner.ts`, `execution.ts`, `reflection.ts`, and `context-loader.ts` contain
**zero references** to Supabase, Groq, `fetch()`, or any concrete
infrastructure. They only import from `types.ts` and `interfaces.ts`.

This is verified by code inspection: grep for `supabase`, `groq`, `fetch` in
these four files returns no matches (excluding this documentation comment).

## What Works on Mock Today

- Full pipeline execution: Task → Plan → Context → Execution → Reflection
- All 7 TaskTypes route correctly and produce type-specific plans
- Safety Layer blocks all write actions by default
- Reasoning produces FACT/INFERENCE/GAP-tagged claims from mock data
- Reflection correctly identifies low-confidence and gap-heavy runs

## What Remains for Real Data Connection

- `SupabaseObservationProvider`, `SupabaseSignalProvider`,
  `SupabaseGraphProvider`, `SupabaseMemoryProvider` — concrete
  implementations of the existing interfaces, reading from
  `observations`, `signals`, `knowledge_graph_nodes`,
  `intelligence_graph`, `entity_registry`, `strategic_memory` (Phase 2)
- A `GroqReasoningEngine` implementing `ReasoningEngine` — replaces
  `MockReasoningEngine` without any change to `execution.ts`
- Explicit write-action allow-listing once the agent needs to write to
  `strategic_memory` or `intelligence_graph`
- Persistent logging sink (currently console-only)

None of this requires changing `runtime.ts`, `planner.ts`, `execution.ts`,
`reflection.ts`, or `context-loader.ts` — only new files implementing
existing interfaces, and updated wiring in `index.ts` (or a production
equivalent).
