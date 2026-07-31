# AIscentra Governance — Index

This directory (`docs/governance/`) is the canonical location for
AIscentra's normative and operational governance documents. It exists to
give a stable, versioned home to documents previously held only in
external project knowledge / conversation context.

**Adding a document to this index does not, by itself, authorize any
code, data, infrastructure, or production change.** Each document below
states its own normative-or-temporary status; none of them substitute
for a separately issued, explicitly scoped implementation task.

## Hierarchy

### 1. Constitution — normative, permanent

**File:** [`AISCENTRA_PROJECT_CONSTITUTION.md`](./AISCENTRA_PROJECT_CONSTITUTION.md)
**Version:** 2.0.0
**Status:** Final normative edition; takes effect upon explicit owner
approval (per the document's own terms).
**Purpose:** The permanent authority hierarchy, evidentiary standards,
architectural boundaries, and prohibited actions governing every
AIscentra task for the owner, ChatGPT, Claude, and the machine
verification loop.
**Not an implementation authorization.** Its presence in memory or in
this repository does not permit fixing problems found while reading it,
performing "improvements along the way," or making any change outside
a separately issued task.

### 2. Product Vision — product-normative, permanent

**File:** [`AISCENTRA_PRODUCT_VISION.md`](./AISCENTRA_PRODUCT_VISION.md)
**Version:** 1.0.0
**Status:** _"Полная редакция для утверждения владельцем AIscentra"_
(full edition pending owner approval) — **this document has not been
confirmed as owner-approved by any primary source available at the time
of this Governance Sync.** It is transcribed here with its original
status line unchanged, and must not be described elsewhere as an active
approved normative Product Vision until the owner explicitly confirms
approval.
**Purpose:** Product mission, identity, target analytical model, and
long-term product success criteria.
**Not an implementation authorization.** Describes target state, not
verified current state; does not permit code, data, or production
changes on its own.

### 3. Approved architecture / ADR / specifications — normative, current

Not yet canonicalized into `docs/governance/`. Existing architecture
references in this repository include `docs/ARCHITECTURE.md` and
`PROJECT_MASTER_DOCUMENTATION.md` at the repository root — these remain
in their existing locations and are outside this Governance Sync task's
scope. A known discrepancy between these two documents was identified
during this task (see the Evidence Manifest of the PR that introduced
this index) and is registered, not resolved, here.

### 4. Master Audit Plan — historical, temporary

**File:** [`AISCENTRA_MASTER_AUDIT_PLAN.md`](./AISCENTRA_MASTER_AUDIT_PLAN.md)
**Status:** Temporary historical master-plan, fixed 29 July 2026. Not
updated to reflect state after that date. Superseded operationally by
the Repair Roadmap (below) for day-to-day phase tracking, while
remaining the permanent, unmodified historical record of the original
audit.
**Purpose:** The original independent audit findings, problem registry,
target architecture, phase sequencing, and ready-made task descriptions
for Claude, as they existed at the time of the audit.
**Not an implementation authorization** and not a source of current
machine-verified state.

### 5. Repair Roadmap — operational, current

**File:** [`AISCENTRA_REPAIR_ROADMAP.md`](./AISCENTRA_REPAIR_ROADMAP.md)
**Version:** 1.0
**Status:** Current operational repair sequence, baselined at
`main@59822d418ec33705c77ba3fcd60dc3fd44cadb72`, dated 31 July 2026.
**Purpose:** Tracks actually-completed phases (Phase 1A, Phase 1B) against
the historical Master Audit Plan's phase numbering, defines the current
phase (Governance Sync) and the next phases (1C–1F, Interphase 1S,
Phases 2–9), and states the standing rules governing how phases are
authorized and accepted.
**Not an implementation authorization by itself** — each listed phase
requires a separately issued, explicitly scoped task before any change
is made.

### 6. Current explicit task — the only direct implementation authorization

Whatever task is explicitly, separately issued by the owner or ChatGPT
in the current conversation. None of documents 1–5 above substitute for
this. This index does not itself constitute a task.

### 7. Primary machine artifacts — evidence, not documents

Per Constitution Article 1.2, the authoritative evidence for "what was
actually done" is never a document in this directory. It is, in order:
commit SHA + PR diff → GitHub Actions status/logs on that SHA →
deterministic test/migration/security-scanner output → Vercel deployment
ID/status/logs → Supabase schema/migration/RLS/data state → reproducible
local command output → a model's report explaining the above (last, and
non-authoritative on its own).

## Evidence subdirectory

[`evidence/`](./evidence/) contains standalone closeout evidence records
for completed phases, referencing (but never rewriting) their
corresponding closed PRs. Currently:

- [`evidence/PHASE_1B_CLOSEOUT.md`](./evidence/PHASE_1B_CLOSEOUT.md)

## Known documentation drift

Recorded here without correction — resolving this drift is outside the
scope of Governance Sync and requires a separate, dedicated docs task:

- `docs/ARCHITECTURE.md` (repository root) describes the project as
  being at an early "Stage 0 — Blueprint (complete) / Stage 1 — Design
  System Foundation (current)" build order.
- `PROJECT_MASTER_DOCUMENTATION.md` (repository root) reflects a
  substantially more mature actual state (Signal Engine V2, Agent
  Runtime, 15 API routes, CI/CD, multiple merged PRs).
- Where these two documents conflict, current state is determined by
  primary artifacts — GitHub, CI, Vercel, Supabase — and by the more
  recently verified `PROJECT_MASTER_DOCUMENTATION.md`, not by
  `docs/ARCHITECTURE.md`.
- Neither conflicting document is edited by this Governance Sync task.
