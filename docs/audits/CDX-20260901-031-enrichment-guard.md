# CDX-20260901-031: legacy enrichment admission guard

Base: `13bceb54ff37ad7e13a3561af5fc30edb413fe04`, remote main observed
2026-09-07. The owner confirms the same Production SHA; independent deployment
verification remains **UNKNOWN** because the Vercel connector is unavailable.
Forensic interval: **[2026-08-31T00:00:00Z, 2026-09-07T00:00:00Z)**.

## Contract and scope

`sis_execution_controls.execution_enabled` belongs to the fixed
`durable_sis_v1_control_20260825` row. The original
`20260825121411_add_durable_sis_v1_pgmq_control.sql` gates start and claim;
`20260829035009_unlock_durable_sis_canary.sql` preserves disabled admission.
These SQL functions may pause existing runs while disabled: they do not promise
zero writes across the entire application. Recovery explicitly requires disabled
execution. There is no pre-existing global prohibition on all AI roles.

This repair extends that existing control to legacy **Signal enrichment admission**,
as requested, not Events, Reports, Assistant, or administrative simulation.
No migration, second flag, schedule removal, model/prompt change, or provider call.

| Entry / caller                                                                   | Downstream                                                       | Audit / repair                                                                             |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `/api/enrich/batch`                                                              | `processObservation` -> classifier/parser -> `agentCompleteJSON` | Guard after auth before client/lock/ledger/queue/metrics                                   |
| `/api/enrich`                                                                    | same engine; observation terminalization                         | Guard after auth before observation read                                                   |
| `/api/internal/sis-replay`                                                       | claim/budget/lock -> same engine                                 | Guard after auth before parsing/claim/lock                                                 |
| `/api/cron/enrich`                                                               | queue SELECT -> `/api/enrich`                                    | Guard before queue read or downstream HTTP; reject missing auth secret                     |
| `/api/cron/pipeline`                                                             | batch, then events/reports                                       | Batch guarded at destination; unrelated events/reports intentionally unchanged             |
| `/api/admin/simulate-engine-v2`                                                  | direct classifier -> simulation audit                            | Separate `ENABLE_ENGINE_SIMULATION` + admin auth; no normal enrichment; unchanged          |
| `/api/cron/events` -> `/api/events/promote`                                      | events engine -> `agentCompleteJSON`                             | Separate lifecycle, unchanged                                                              |
| `/api/cron/reports` -> `/api/reports/generate`                                   | reports engine -> `agentCompleteJSON`                            | Separate lifecycle, unchanged                                                              |
| `/api/agent` -> `supabase/functions/intelligence-agent/groq-reasoning-engine.ts` | `agentCompleteJSON`                                              | Separate `ENABLE_INTERNAL_AGENT_API` + internal auth; unchanged                            |
| `/api/assistant`                                                                 | separate Groq streaming client, not `agentCompleteJSON`          | Public Assistant access/quota contract; relevant to shared-key attribution only; unchanged |
| `src/lib/openrouter/agent.ts`                                                    | legacy same-named JSON helper                                    | Separate declaration, not a discovered legacy Signal entrypoint                            |

All production `processObservation` references in `src` were traced: the three
direct routes above, and batch dependencies used by replay. Durable start/stage
use their SQL admission/claim contract and do not call this legacy engine.

## Forensic evidence and limitations

Source schedules: `.github/workflows/enrich-batch-hourly.yml` has five slots
(01:30, 05:30, 13:30, 17:30, 21:30 UTC); `vercel.json` schedules pipeline at
10:00 UTC. This is 42 configured enrichment opportunities in seven complete days,
**not 42 verified invocations or provider charges**. Cron execution delays,
deployed schedule versions, eligibility and lock/budget skips are unverified.

Before this patch, the legacy paths did not consult execution state. Batch could
acquire/release `execution_locks`, prune/consume token ledger, write observation
processed/retry metadata, engine Signal/decision records and `pipeline_metrics`.
Replay could additionally write its claim/audit markers. These are **reachable
mutations in code, not proven Production mutations in this interval**.

Access gaps: Supabase transport failure; Vercel transport failure; GitHub connector
transport failure; GitHub CLI unauthenticated; public GitHub API SSL failure.
No Groq usage export or request correlation artifacts available. Actual daily
provider usage, invocation counts, historical switch values and row deltas remain
UNKNOWN. Schedule coincidence alone cannot attribute usage to enrichment, because
Events/Reports/other provider consumers also exist.

## Verification and release evidence

Route tests intercept every HTTP request: disabled/read-error paths make exactly
one control SELECT, with zero downstream lock/queue/ledger/metrics/provider calls.
Enabled routes retain normal admission. PostgreSQL harness uses real temporary
PostgreSQL, existing migrations and existing SQL assertions, then tests the actual
guard with database-backed execution state. Windows-only adaptations use loopback
instead of Unix sockets and strip CRLF from psql stdout, retaining pipefail.

Release still requires terminal local results, review of exact diff, automatic
Canonical QG after separately authorized push, current deployment/schema/control
verification, and separate deployment approval. Forensic attribution additionally
needs Groq timestamped usage plus GitHub/Vercel invocation artifacts and DB metrics
with historical switch state. No Production changes were made by this task.

The guard is admission control, not cancellation of an already admitted request.
It fails closed with 503 on missing/malformed/unreadable state; false returns
`{ skipped: true, reason: "execution_disabled" }` with 200. Rollback is a code revert;
it restores the unsafe legacy bypass and is therefore not a harmless fallback.
