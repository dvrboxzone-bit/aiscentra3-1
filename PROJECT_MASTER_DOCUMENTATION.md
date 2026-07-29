# AIscentra — Project Master Documentation

**Document status:** Primary technical reference (v2 — audited and elevated)
**Last verified:** July 29, 2026
**Verification basis:** Real production execution (Runtime HTTP Integration + End-to-End Validation), direct SQL inspection of live Supabase tables, live Vercel deployment inspection, direct source-code inspection of all API routes and `vercel.json`

This document describes only what has been built and verified to exist. Where a component returns empty data, is stale, or is not yet implemented, this is stated explicitly. A new engineer should be able to read this document alone — without reading prior phase reports — and understand the architecture, execution flow, production topology, limitations, and future direction.

---

## 1. Executive Summary

AIscentra is an **AI Intelligence Observatory** — not a news aggregator. Its purpose is to observe, analyze, connect, and explain the evolution of artificial intelligence through structured Intelligence Signals, distinguishing itself from content aggregation by requiring every published Signal to represent genuine evidence of ecosystem-level change rather than a well-written summary of a paper or product announcement.

The long-term vision is a platform that functions analogously to a Bloomberg Terminal for the AI industry: scarce, high-conviction, evidence-linked intelligence that professionals can trust precisely because most of what crosses the Observatory's desk is filtered out, not published.

---

## 2. System Overview

| Subsystem | Responsibility |
|---|---|
| Web Application | Next.js 16 (App Router) app serving the Observatory and all API routes. Deployed on Vercel. |
| Signal Engine (V2) | Automated pipeline: ingests observations, qualifies against deterministic + LLM-scored criteria, publishes Signals/Weak Signals or discards with recorded reason. Feature Freeze; Statistical Acceptance pending. |
| Observatory | Public product surface — Signals, Events, Reports, Assistant chat. |
| Agent Runtime | Separate Intelligence Agent engine (Planner→Context Loader→Execution→Reflection) running analytical tasks against real Observatory data + Groq reasoning. Read-only w.r.t. Signal Engine data. |
| Supabase | Postgres + RLS for all persistent data. |
| Groq | Sole LLM provider for both engines, via shared `src/lib/ai/*` abstraction. No second LLM, no Cloudflare AI. |
| Vercel | Hosting, deployment, cron. Hobby-tier limits (1 daily cron, 60s timeout) shaped batch-sizing decisions. |

---

## 3. Current Architecture

### 3.1 Signal Engine Lifecycle

```
RSS/arXiv sources → /api/collect → observations table
      ↓
/api/enrich/batch (invoked by /api/cron/pipeline, daily 10:00 UTC)
      ↓
Hard Rejection → Category/Dedup → Graph ingestion → SIS (Groq) →
Enrichment (Groq) → Validation/Scoring → SIGNAL|WEAK_SIGNAL|ARCHIVE|DISCARD
      ↓
signals table + signal_decision_log
```

### 3.2 Agent Runtime Lifecycle (step-by-step)

**Step 1 — Task creation.** `src/app/api/agent/route.ts` receives GET with `q` param, validates non-empty, trims to 500 chars, builds `AgentTask{ id, type: routeTask(query), query, parameters:{}, requestedBy:"http-api", createdAt }`. `routeTask()` is pure regex classification into one of 7 `TaskType`s — no LLM.

**Step 2 — Planning.** `createExecutionPlan(task)` looks up a static step sequence for the `TaskType` from `TASK_PIPELINES`. For INVESTIGATION: LOAD_OBSERVATIONS(required)→LOAD_SIGNALS(required)→LOAD_GRAPH(optional)→LOAD_MEMORY(optional)→REASON(required)→GENERATE_REPORT(required). Zero I/O, zero LLM — pure function of TaskType.

**Step 3 — Context loading.** `ContextLoader.load()` calls each provider per step kind present in the plan (ObservationProvider.getRecent, SignalProvider.getRecent, GraphProvider.getNodesByType, MemoryProvider.getRelevant, GraphProvider.searchEntities). Each call wrapped in try/catch; thrown errors append to `context.gaps`. Returns full `AgentContext`.

**Step 4 — Execution dispatch (LOAD_* steps).** `Execution.run()` iterates steps: resolve `AgentAction` → `SafetyProvider.checkAction()` → resolve `ExecutionTool` from Registry → `tool.execute()`. LOAD_* tools just return counts of already-fetched context data — no re-fetch.

**Step 5 — Reasoning.** REASON step resolves `ReasonTool` → calls `reasoningEngine.reason({task, context})`. Production: `GroqReasoningEngine` builds a structured prompt from full context, calls `agentCompleteJSON()` with the pre-existing `'analyzer'` role, validates against `GroqReasoningOutputSchema` (Zod), merges with Runtime-owned `taskId`/`reasonedAt`. Only step with a network LLM call.

**Step 6 — Report generation.** `GENERATE_REPORT` → `ReportExecutionTool` reads the REASON output via an injected closure, returns `{reportGenerated, summary}`. Not persisted anywhere — exists only in the response object.

**Step 7 — Reflection.** `Reflection.reflect()` runs synchronously post-execution: inspects failures, confidence threshold, gap count → produces `{success, failure, confidence, durationMs, lessons[], nextActions[], reflectedAt}`. No writes, no side effects beyond logging.

**Step 8 — Response serialization.** Route wraps `{task, plan, context, execution, reflection}` in `NextResponse.json()`. Full object returned, nothing stripped.

### 3.3 Dependency Graph

```
Web Application (src/app)
  ├─►Signal Engine (src/modules/signals,...) ─►Supabase (src/lib/supabase/server.ts) ─►Groq (src/lib/ai/*)
  └─►Agent Runtime (supabase/functions/intelligence-agent)
        ├─►Supabase (supabase-providers.ts, @supabase/supabase-js DIRECTLY — not server.ts)
        └─►Groq (groq-reasoning-engine.ts, dynamic import of src/lib/ai/agent.ts)
```

Dependency direction is one-way. Signal Engine has zero knowledge of Agent Runtime. Agent Runtime's core modules (Planner/Execution/Reflection/Safety/ContextLoader) have zero knowledge of Supabase/Groq — those live only in leaf providers, injected at the composition root (`index.ts`).

**Structural note:** two independent Supabase client paths exist — `src/lib/supabase/server.ts` (Next.js, depends on `next/headers`) for Web/Signal Engine, and a separate lazy client in `supabase-providers.ts` for Agent Runtime (can't use the Next.js client outside a Next.js request context).

### 3.4 Directory Overview

| Path | Purpose |
|---|---|
| `src/app/` | Pages + all API routes |
| `src/modules/` | Signal Engine domain logic: signals, observations, events, reports, entities, assistant |
| `src/lib/ai/` | Shared LLM abstraction (client, agent, config, models) used by both engines |
| `src/lib/supabase/` | Next.js Supabase client — Signal Engine/Web only, not Agent Runtime |
| `src/config/` | Env validation (`env.ts`) |
| `supabase/migrations/` | Authoritative SQL schema history |
| `supabase/functions/intelligence-agent/` | Entire Agent Runtime + 7 `AGENT_*.md` docs. **Not deployed as a Supabase Edge Function** (no `config.toml`) — reachable only via `/api/agent` in the Next.js bundle |
| `vercel.json` | Deployment config incl. the single registered cron |
| `next.config.ts` | Currently sets `typescript.ignoreBuildErrors: true` (Sections 7/11) |
| `tsconfig.json` | Excludes `supabase/functions`, though this doesn't stop type-checking of files reached via `import` |

---

## 4. Runtime Architecture (Component Responsibilities)

| Component | File | Responsibility |
|---|---|---|
| Task | `types.ts` | `id, type, query, parameters, requestedBy, createdAt` |
| Planner | `planner.ts`+`task-router.ts` | Deterministic step-sequence lookup by TaskType. `ExecutionPlan.createdAt` is the one non-deterministic field. |
| Context Loader | `context-loader.ts` | Assembles AgentContext via 4 provider interfaces. Empty-but-successful results not flagged as gaps except LOAD_MEMORY. |
| Providers | `mock-providers.ts`, `supabase-providers.ts` | Satisfy ObservationProvider/SignalProvider/GraphProvider/MemoryProvider. Supabase providers fail closed on missing credentials. |
| Reasoning Engine | `reasoning-engine.ts`(Mock), `groq-reasoning-engine.ts`(prod) | Single-method interface; Groq impl reuses `agentCompleteJSON` + `'analyzer'` role. |
| Execution | `execution.ts`+`execution-tools.ts` | Dispatch via Safety+Registry. No business logic beyond dispatch/safety/timing. |
| Reflection | `reflection.ts` | Deterministic self-assessment, read-only. |
| Report Generation | `ReportExecutionTool` | Formats reasoning output; not persisted. |

Safety: deny-by-default writes, two independent fail-closed layers (total `STEP_TO_ACTION` mapping + `ExecutionToolRegistry` throw).

---

## 5. API Surface (Complete)

### Agent Runtime
| Endpoint | Method | Status |
|---|---|---|
| `/api/agent` | GET | Live, **no authentication** |

### Signal Engine — Pipeline
| Endpoint | Method | Status |
|---|---|---|
| `/api/collect` | POST | Live; invoked by pipeline |
| `/api/enrich` | POST | Live; manual |
| `/api/enrich/batch` | POST | Live; invoked by pipeline |
| `/api/cron/pipeline` | GET | **Only cron registered in vercel.json**, daily 10:00 UTC |
| `/api/cron/collect` | GET | Code exists, **NOT scheduled** — stale "every 4h" comment |
| `/api/cron/enrich` | GET | Code exists, **NOT scheduled** — stale comment |
| `/api/cron/events` | GET | Sub-call from pipeline only |
| `/api/cron/momentum` | GET | **Dead from scheduling standpoint** — stale "daily 02:00" comment, not in vercel.json, not called by pipeline |
| `/api/cron/reports` | GET | Sub-call from pipeline only |

### Signal Engine — Admin
| Endpoint | Method | Status |
|---|---|---|
| `/api/admin/simulate-engine-v2` | GET | Live, public |
| `/api/events/promote` | POST | Live |
| `/api/reports/generate` | POST | Live |
| `/api/health` | GET | Live, public |

### Observatory
| Endpoint | Method | Status |
|---|---|---|
| `/api/assistant` | POST | Live, streaming SSE |

---

## 6. Configuration

### Environment Variables (names only)
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GROQ_API_KEY`, `CRON_SECRET`, `ADMIN_EMAIL`, `OPENROUTER_API_KEY`(reserved, inactive), `OPENROUTER_MODEL`(reserved, inactive).

`/api/agent` has no dedicated auth variable.

### Production Services
Vercel (hosting + single daily cron, 60s timeout), Supabase (Postgres, two client paths), Groq (sole LLM).

### Deployment
```
GitHub main → Vercel Build (Turbopack) → Production
  ├─ serves all HTTP traffic incl. /api/agent
  └─ runs /api/cron/pipeline daily 10:00 UTC → fires collect/enrich-batch/events/reports
```
Agent Runtime ships inside the same build — not a separate service.

---

## 7. Failure Modes

| Scenario | Behavior |
|---|---|
| Knowledge Graph empty | Returns `[]`, no error, **not flagged as gap** |
| Strategic Memory missing | Returns `[]` by design; write() throws explicitly; **is flagged as gap** |
| Entities not found | Returns `[]`, not flagged as gap |
| Provider failure | Caught, logged, appended to gaps; other providers unaffected |
| Groq failure | Retries via existing backoff, then throws; REASON step fails; overall success:false; Reflection reports specific failure |
| DB credentials missing | Explicit thrown error, confirmed by test |
| Unknown step kind | `UnknownExecutionStepKind` thrown, caught, recorded as failure |
| Unauthorized write | Denied by default unless explicitly allow-listed |

---

## 8. State Matrix

| Component | Exists | Production | Verified | Notes |
|---|---|---|---|---|
| Signal Engine V2 | Yes | Yes | Yes | Feature Freeze |
| `signal_decision_log` | Yes | Yes | Yes | Full audit trail |
| `entity_registry` | Yes | Yes | Yes | 15 seeded entities |
| `entities` | Yes | Yes | Yes | 80 rows, distinct table |
| `knowledge_graph_nodes` | Yes(schema) | Yes(empty) | Yes | 0 rows |
| `intelligence_graph` | Yes(schema) | Yes(empty) | Yes | 0 rows |
| `strategic_memory` | **No** | No | N/A | Phase 2 |
| Planner/ContextLoader | Yes | Yes | Yes | |
| ObservationProvider/SignalProvider (Supabase) | Yes | Yes | Yes | Real rows confirmed live |
| GraphProvider (Supabase) | Yes | Yes | Yes | Correctly empty, not erroring |
| MemoryProvider (Supabase) | Yes | Yes | Yes | `[]` + write-throw confirmed |
| GroqReasoningEngine | Yes | Yes | Yes | 2124ms real latency observed |
| Execution/Safety/Registry | Yes | Yes | Yes | Fail-closed confirmed |
| Reflection | Yes | Yes | Yes | Confirmed accurate |
| `/api/agent` | Yes | Yes | Yes | Real HTTP round-trip 2026-07-29 |
| `/api/agent` auth | **No** | No | N/A | High debt |
| Edge Function deployment | **No** | No | N/A | Bundled into Next.js instead |
| `/api/cron/pipeline` | Yes | Yes, daily | Yes | Only registered cron |
| Other cron schedules | Code only | **No** | N/A | Stale comments |
| Multi-Agent/Auth/Quotas/Billing/Teams | No | No | N/A | Undesigned |

---

## 9. Development Principles

Evidence First · No Fabricated Data · Fail Closed · Dependency Injection · Single Responsibility · Type Safety (`strict`, `noUnusedLocals`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) · Production Before Optimization · Observable Execution (every step records success/output/error/durationMs) · Explicit Error Handling.

---

## 10. Future Architecture

| Subsystem | Why | Problem solved | Dependency first |
|---|---|---|---|
| Knowledge Graph Expansion | Tables empty | Entity-aware investigations | Signal Engine ingestion at scale |
| Strategic Memory | No cross-investigation memory | Avoid "forgetting" | Schema + migration |
| Multi-Agent Collaboration | No hand-off architecture | Decompose complex queries | Stable single-agent + orchestration layer |
| User Workspace | No saved-investigation concept | Return to prior results | Authentication |
| Authentication | No identity layer | Enables usage-based features | None — first dependency |
| Quotas | No rate-limiting | Cost/abuse control | Authentication |
| Billing | No monetization | Revenue | Quotas + Auth |
| Team Workspaces | No org concept | Shared access | User Workspace + Auth |

---

## 11. Technical Debt

**High:** `ignoreBuildErrors:true` project-wide (fix: remove dead field in execution.ts, revert flag) · `/api/agent` no auth/rate-limit · 3 cron routes with stale schedule comments · Signal Engine Statistical Acceptance incomplete.

**Medium:** Two entity tables unreconciled · Agent Runtime directory naming implies Deno deployment that doesn't exist · Context Loader doesn't flag empty-successful results as gaps (except LOAD_MEMORY) · Two independent Supabase client paths.

**Low:** `ExecutionPlan.createdAt` non-deterministic · `HYPOTHESIS` claim type unused by any engine.

---

## 12. Development Roadmap

1. Knowledge Graph Expansion 2. Strategic Memory 3. Observatory Expansion 4. Web UI Integration 5. Authentication 6. Plans & Quotas 7. Billing 8. Beta Release 9. Production Release

---

## 13. Decision Log

| Decision | Reason | Impact | Date |
|---|---|---|---|
| SIS 4-dimension redesign | Too many "good papers" = Signals | Volume dropped, quality up | 2026-07-28 |
| Weak Signals via `intelligence_type` column | Simpler schema | Single-table queries | 2026-07-28 |
| Human Relevance: gate→modifier | Hard gate discarded high-SIS signals unfairly | High-SIS/zero-role → Weak not Discard | 2026-07-28 |
| Caps read structured fields not `engine_justification` prose | Circular logic risk | Auditable via `rule_trace` | 2026-07-28 |
| Publication classification → deterministic code | Unneeded LLM dependency | LLM only analyzes content | 2026-07-28 |
| "Feature Freeze" not "Certified" | Avoid overstating readiness | Changes require version bump | 2026-07-28 |
| Agent Runtime full Dependency Inversion | Mock/Prod coexistence | 100% shared pipeline code | 2026-07-28/29 |
| `switch`→`ExecutionToolRegistry` | Missing mapping = silent Safety bypass (Critical) | Two independent fail-closed layers | 2026-07-29 |
| GroqReasoningEngine reuses `agentCompleteJSON`+`'analyzer'` | Avoid new client/role | Zero changes to models.ts | 2026-07-29 |
| Supabase providers use `@supabase/supabase-js` directly | Next.js client unusable here | Two client paths (Medium debt) | 2026-07-29 |
| `ignoreBuildErrors:true` | Runtime files forbidden to edit | Build gate disabled (High debt) | 2026-07-29 |
| `/api/agent` as GET+`q` param | Matches simulate-engine-v2 precedent | No auth yet (High debt) | 2026-07-29 |

---

## 14. Documentation Quality Self-Review

**Resolved:** Runtime lifecycle expanded to full 8-step narrative · dependency direction + two-client-paths made explicit.
**Assumptions removed:** all cron routes assumed scheduled (false — only pipeline is) · Context Loader gap-tracking assumed complete (false — errors only, not empty successes).
**Added:** full API table (15 endpoints) · Configuration section · behavioral Failure Modes · single-table State Matrix.
**Remaining gaps:** no load-testing docs · no migration-rollback process documented · Observatory Assistant's own retrieval architecture under-detailed · no Agent Runtime versioning scheme (Signal Engine has one, Agent Runtime doesn't).
