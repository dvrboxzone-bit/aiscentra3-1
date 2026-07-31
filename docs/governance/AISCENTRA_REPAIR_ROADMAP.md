AISCENTRA REPAIR ROADMAP
Version 1.0
Status: Current operational repair sequence
Baseline: main@bf4d507319c20160b742fc2de5d0398b5c047360
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

### 3. Governance Sync — **COMPLETED**

PR #5 merged (`bf4d507319c20160b742fc2de5d0398b5c047360`) and automatically
deployed to production (`dpl_DNUoRmQf3kj68UPS4Z4FoQyEVsZG`, `READY`,
`target: production`, `githubCommitSha` confirmed matching the merge
commit exactly). Canonicalized Constitution, Product Vision (owner-provided
canonical source, status unchanged — **not approved**), the historical
Master Audit Plan, this Repair Roadmap, and Phase 1B closeout evidence
into `docs/governance/**`. No production route, migration, Supabase
schema, RLS, GitHub Actions, or Vercel/environment change was part of
this phase.

This merge-then-automatic-deploy sequence is exactly the confirmed
current behavior that Phase 1C (below) exists to separate.

### 4. Phase 1C — Merge/deployment governance separation — **CURRENT — DESIGN COMPLETE, 1C-B1 COMPLETED, 1C-B2 NOT STARTED**

Separate, explicit confirmations for merge and production deployment;
remove the dependency where merging a PR automatically triggers a
production deployment, to the extent technically possible within the
current Vercel Git-integration model.

Split into two sequential stages, per
`docs/governance/decisions/PHASE_1C_DEPLOYMENT_SEPARATION.md`:

**Phase 1C-B1 — Protected Main and Exact-SHA CI (COMPLETED).**
The owner created and activated the `Protect main` GitHub repository
ruleset (confirmed live: `pull_request` required, the Quality Gate check
required, force-push and deletion blocked, no bypass actors configured;
required check context unchanged: `Quality Gate (format, lint,
type-check, test, build)`). The remaining engineering gap — proving the
required Quality Gate check is actually evaluated against the exact
final commit SHA on `main`, not only the ephemeral pre-merge synthetic
merge commit — is now closed and independently verified:

- PR #8 merged; merge/main SHA
  `0bf8fe15604808a7ca94b532689f6b209804aed9`.
- Automatic `push`-triggered Quality Gate run `30629372155`
  (job `91151923416`): `event=push`, `ref=refs/heads/main`,
  `head_sha` equal to the merge SHA. `github.sha` and `git.head` equal
  the merge SHA (proven by the "Confirm tested commit identity" step's
  own pass/fail assertion succeeding, not merely asserted).
- Push-specific format-check step (`Changed-files format check (push to
main)`) succeeded using the real prior `main` SHA
  (`c41a1c1b9fcba6fb96545c5ac13673da3e261f40`) as its comparison base —
  the fail-closed full-repository fallback was not needed.
- 95/95 tests passed; production build succeeded; Next.js `16.2.12`.
- Production dependency audit on this exact commit: `critical 0, high 0,
moderate 0, low 2, total 2` (artifact ID `8792716966`).
- Automatic production deployment `dpl_A9wVLvHYqrvwhHE2NJANxatCmi9U`
  reached `READY`, `target: production`, `source: git`,
  `githubCommitRef: main`, `githubCommitSha` equal to the merge SHA.
- Production smoke (`https://aiscentra.com/`, `/api/health`,
  `/opengraph-image`) reported as HTTP 200/200/200 with
  `/opengraph-image` returning `content-type: image/png`. **This smoke
  result was not independently re-verified by Claude in the governance
  documentation task itself** — Claude's own sandbox network egress
  policy blocked direct requests to `aiscentra.com` throughout this
  session (`x-deny-reason: host_not_allowed`); the 200/200/200 result is
  carried forward from the owner's/ChatGPT's own verification, not
  re-confirmed here.

**Explicitly not claimed by this completion:** automatic Vercel
production deployment from `main` is still fully enabled — Phase 1C-B1
did not disable it. Phase 1C as a whole is not complete until Phase
1C-B2 also lands.

**Phase 1C-B2 — Manual Production Release (NOT STARTED).** Disabling
automatic Vercel deployment for `main`, introducing a project-scoped
Vercel API token stored as a GitHub Environment secret, and an
owner-triggered `workflow_dispatch` release workflow implementing the
exact-SHA release gate specified in the decision record. Now that
Phase 1C-B1 is independently confirmed complete, B2 may be scoped as
its own separate task and requires its own separate, explicit owner
authorization before implementation begins — it is **not** implemented,
authorized, or started by this governance-sync document.

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

Baseline commit: `bf4d507319c20160b742fc2de5d0398b5c047360` (`main`,
merge commit of PR #5).

This document supersedes the historical Master Audit Plan
(`docs/governance/AISCENTRA_MASTER_AUDIT_PLAN.md`, fixed 29 July 2026)
as the current operational reference for phase sequencing. The
historical document is retained unmodified as a permanent audit-trail
record and is not rewritten to match current state.
