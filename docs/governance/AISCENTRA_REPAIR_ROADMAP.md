AISCENTRA REPAIR ROADMAP
Version 1.0
Status: Current operational repair sequence
Baseline: main@59822d418ec33705c77ba3fcd60dc3fd44cadb72
Date: 31 July 2026

---

## Purpose

This document is the **current operational repair sequence** for
AIscentra, replacing day-to-day reliance on the historical
`AISCENTRA_MASTER_AUDIT_PLAN.md` (fixed 29 July 2026) for tracking what
has actually been completed versus what remains.

This document does not authorize implementation by itself. Each phase
requires a separately issued, explicitly scoped task before any code,
data, infrastructure, or production change is made — per
`AISCENTRA_PROJECT_CONSTITUTION.md` Article 1.4 and this roadmap's own
Standing Rules below.

---

## Sequence

### 1. Phase 1A — API containment — **COMPLETED**

PR #3 merged and deployed.

Closed unauthenticated access to `/api/agent`,
`/api/admin/simulate-engine-v2`, and `/api/assistant`: guard-before-import,
constant-time secret comparison, safe response DTOs, fail-closed
environment matrix for the Assistant.

### 2. Phase 1B — API boundary inventory and enforcement baseline — **COMPLETED**

PR #4 merged and deployed.

Full machine-verified inventory of all 15 `src/app/api/**` routes, with
a CI-enforced consistency checker (`npm run check:api-inventory`).
Established the current confirmed security baseline (see below).

### 3. Governance Sync — **CURRENT**

Only canonicalization of governance documents (Constitution, Product
Vision, historical Master Audit Plan, this Repair Roadmap, Phase 1B
closeout evidence) into `docs/governance/**`, and fixation of the
current phase sequence. No production route, migration, Supabase
schema, RLS, GitHub Actions, or Vercel/environment change is part of
this phase.

### 4. Phase 1C — Merge/deployment governance separation

Separate, explicit confirmations for merge and production deployment;
remove the dependency where merging a PR automatically triggers a
production deployment, to the extent technically possible within the
current Vercel Git-integration model. Scope, risk level, and exact
technical approach to be re-cut by ChatGPT against the actual current
Vercel project configuration before this phase begins.

### 5. Phase 1D — Centralized machine/cron access and error sanitization

Centralized guards for the remaining machine/cron routes (currently 11
routes using a duplicated, non-constant-time `CRON_SECRET` check per the
Phase 1B inventory — see baseline below), constant-time secret
comparison, and removal of raw caller-facing infrastructure errors
(currently 5 confirmed routes leaking raw `error.message` per the Phase
1B inventory).

### 6. Phase 1E — Rate limits, quotas and AI budget controls

Caller-facing per-user/per-workspace rate limits, quotas, paid-operation
budget guards, and cost telemetry. Per Constitution Article 12.7, an
in-memory limiter on a single serverless instance does not qualify as
sufficient protection — a durable, serverless-appropriate mechanism is
required.

### 7. Phase 1F — Health and security gates

Safe health-endpoint contracts (public health limited to ok/degraded per
Constitution Article 12.9), security regression gates, and production
verification procedures.

### 8. Interphase 1S — Signal Delivery Integrity

Investigated separately from the phases above, not bundled with any of
them:

- DB finalization integrity (Signal Engine transactional guarantees);
- presence of ACTIVE Signals in the database;
- delivery of ACTIVE Signals to `/signals`;
- DB ↔ UI discrepancies;
- explicitly do not conflate the problem of Signals being _created_ with
  the problem of Signals being _displayed_ — these are two distinct
  failure surfaces requiring independent diagnosis.

### 9. Phases 2–9

Executed sequentially per the historical Master Audit Plan's own
phase numbering (Type Safety & CI already substantially addressed via
the Quality Gate Bootstrap PR #2, ahead of this roadmap's own explicit
listing — noted here as a known sequencing note, not re-litigated).
Each phase is re-cut by ChatGPT against the actual current primary
artifacts (GitHub, CI, Vercel, Supabase) immediately before it begins —
the historical Master Audit Plan's original phase descriptions are a
starting reference, not a frozen specification to execute verbatim
months later.

---

## Standing Rules

- One primary implementation task at a time.
- One task, one acceptance — no bundling multiple unrelated fixes into a
  single PR.
- Corrections are made within the same PR that introduced the issue,
  not deferred to a later cleanup task, unless explicitly redirected.
- A new major phase does not begin before the previous one is confirmed
  complete via primary artifacts (merged PR, passing CI on the merge
  commit, and where applicable, verified production deployment).
- A model's own report is not evidence. Per Constitution Article 1.2,
  the evidence hierarchy is: commit SHA + diff → CI status/logs on that
  SHA → deterministic test/migration/security-scanner output → Vercel
  deployment status/logs → Supabase schema/data state → reproducible
  local command output → the model's report explaining the above (last,
  and non-authoritative on its own).
- Every PR requires: head SHA, CI run ID and result, an Evidence
  Manifest, and independent review before merge is authorized.
- Merge and production deployment require separate, explicit owner
  decisions. A merge is never treated as implicit authorization to
  deploy to production.
- This roadmap does not, by itself, authorize implementation of any
  listed phase. Each phase requires its own explicitly issued task.

---

## Confirmed Phase 1B Security Baseline

The following is the machine-verified state as of Phase 1B (PR #4,
merged), confirmed via `docs/audits/api-boundary-inventory.json` and
`npm run check:api-inventory`:

```
15 API routes
P0: 0
P1: 13
P2: 2
P3: 0
11 weak shared-secret routes
5 confirmed raw-error-exposure routes
15/15 routes without a real caller-facing HTTP rate limit
11/11 cost-sensitive routes without a budget guard
```

**These findings are not resolved by this document.** They remain open
until the specific repair phase addressing each (Phase 1D for weak
secrets and raw-error exposure; Phase 1E for rate limits and budget
guards) is executed, tested, and independently confirmed via CI and PR
review. Listing them here is a restatement of the confirmed baseline for
operational tracking, not a claim of remediation.

---

## Source

Baseline commit: `59822d418ec33705c77ba3fcd60dc3fd44cadb72` (`main`).

This document supersedes the historical Master Audit Plan
(`docs/governance/AISCENTRA_MASTER_AUDIT_PLAN.md`, fixed 29 July 2026)
as the current operational reference for phase sequencing. The
historical document is retained unmodified as a permanent audit-trail
record and is not rewritten to match current state.
