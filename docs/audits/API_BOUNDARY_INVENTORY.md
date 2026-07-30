# API Boundary Inventory — Phase 1B

**Baseline SHA:** `4e0597b1d5f4920eb01e7fa226bb32061adc5390`
**Machine-readable source of truth:** [`api-boundary-inventory.json`](./api-boundary-inventory.json)
**Audit method:** direct reading of every `route.ts` file's source code and its import graph — not automated extraction, not inferred from naming conventions.

This is an **audit and enforcement-baseline document**. It records what
exists today. It does not implement rate limiting, quotas, or budget
guards — those are explicitly out of scope for this PR (see Restrictions
below). Findings marked here as missing controls remain missing after
this PR merges; only the _visibility_ of that debt changes.

---

## 1. Total routes

**15** route files under `src/app/api/**/route.ts`, confirmed by direct
filesystem scan (`find src/app/api -name route.ts`), cross-checked
programmatically against the inventory by `npm run check:api-inventory`.

## 2. Routes by security category

| Category             | Count |
| -------------------- | ----: |
| `cron`               |    11 |
| `public-read`        |     2 |
| `admin`              |     1 |
| `internal-machine`   |     1 |
| `authenticated-user` |     0 |
| `disabled`           |     0 |

**Note on `cron` count:** category naming reflects intended trust boundary
(shared `CRON_SECRET`), not actual Vercel cron registration. Of these 11,
only `/api/cron/pipeline` is registered in `vercel.json`. See Section 12.

## 3. Full route table

| Path                            | Methods   | Category         | Guard                                        | AI  | Service-role | DB write | Rate limit           | Budget guard |  Risk  |
| ------------------------------- | --------- | ---------------- | -------------------------------------------- | :-: | :----------: | :------: | -------------------- | ------------ | :----: |
| `/api/admin/simulate-engine-v2` | GET, POST | admin            | `checkAdminAccess`                           | ✅  |      ✅      |    ✅    | missing              | missing      |   P1   |
| `/api/agent`                    | GET, POST | internal-machine | `checkInternalAccess`                        | ✅  |      ✅      |    —     | missing              | missing      |   P1   |
| `/api/assistant`                | POST      | public-read      | `checkPublicAssistantAccess`                 | ✅  |      —       |    —     | missing              | missing      |   P1   |
| `/api/collect`                  | POST      | cron             | local `isAuthorized()`                       |  —  |      ✅      |    ✅    | missing              | missing      |   P1   |
| `/api/cron/collect`             | GET       | cron             | inline check                                 |  —  |      ✅      |    —     | missing              | missing      |   P2   |
| `/api/cron/enrich`              | GET       | cron             | inline check                                 |  —  |      ✅      |    —     | missing              | missing      |   P2   |
| `/api/cron/events`              | GET       | cron             | inline check                                 |  —  |      —       |    —     | missing              | missing      |   P2   |
| `/api/cron/momentum`            | GET       | cron             | inline check                                 |  —  |      ✅      |    ✅    | missing              | missing      |   P1   |
| `/api/cron/pipeline`            | GET       | cron             | inline check (fail-closed on missing secret) |  —  |      —       |    —     | missing              | missing      |   P1   |
| `/api/cron/reports`             | GET       | cron             | inline check                                 |  —  |      ✅      |    —     | missing              | missing      |   P2   |
| `/api/enrich/batch`             | POST      | cron             | local `isAuthorized()`                       | ✅  |      ✅      |    ✅    | internal pacing only | missing      | **P0** |
| `/api/enrich`                   | POST      | cron             | local `isAuthorized()`                       | ✅  |      ✅      |    ✅    | missing              | missing      |   P1   |
| `/api/events/promote`           | POST      | cron             | local `isAuthorized()`                       | ✅  |      ✅      |    ✅    | domain-specific only | missing      |   P1   |
| `/api/health`                   | GET       | public-read      | none (intentional)                           |  —  |      ✅      |    —     | missing              | n/a          |   P2   |
| `/api/reports/generate`         | POST      | cron             | local `isAuthorized()`                       | ✅  |      ✅      |    ✅    | missing              | missing      | **P0** |

## 4. Routes with AI calls (7)

`/api/admin/simulate-engine-v2`, `/api/agent`, `/api/assistant`,
`/api/enrich/batch`, `/api/enrich`, `/api/events/promote`,
`/api/reports/generate`.

**Every one of these has `rateLimit: missing` or internal-pacing-only, and
every one has `budgetGuard: missing`.** This is the single most important
finding of this audit: there is currently no caller-facing rate limit or
cost cap on any AI-calling route in this repository. Phase 1A closed
_unauthenticated_ access; it did not — and was not scoped to — add rate
limiting or cost controls for authenticated/cron-triggered access.

## 5. Routes with service-role access (12)

`/api/admin/simulate-engine-v2`, `/api/agent`, `/api/collect`,
`/api/cron/collect`, `/api/cron/enrich`, `/api/cron/momentum`,
`/api/cron/reports`, `/api/enrich/batch`, `/api/enrich`,
`/api/events/promote`, `/api/health`, `/api/reports/generate`.

`/api/health` is included here only because it constructs an admin client
for `head:true` count queries — it never returns row-level data, so its
actual RLS-bypass exposure is minimal despite the service-role flag being
technically true.

## 6. Routes with database writes (7)

`/api/admin/simulate-engine-v2`, `/api/collect`, `/api/cron/momentum`,
`/api/enrich/batch`, `/api/enrich`, `/api/events/promote`,
`/api/reports/generate`.

## 7. Routes without rate limiting (13 of 15)

All routes except `/api/enrich/batch` (internal AI-call pacing only, not a
caller-facing rate limit) and `/api/events/promote` (domain-specific
per-category promotion cap via `checkRateLimits()`, not a per-caller HTTP
rate limit). **No route in this repository has an actual per-caller HTTP
request rate limit.**

## 8. Routes without a quota/budget guard (13 of 15)

All routes except `/api/health` (not cost-sensitive, `n/a`). Every
cost-sensitive (AI-calling) route has `budgetGuard: missing`.

## 9. Routes with raw-error exposure risk (5)

`/api/collect`, `/api/cron/collect`, `/api/cron/enrich`,
`/api/cron/momentum`, `/api/health` — each returns a raw Supabase
`error.message` directly to the caller on a database-error code path.
This is a **newly-discovered finding in this audit**, not previously
documented. None of these were in Phase 1A's scope (which addressed
`/api/agent`, `/api/admin/simulate-engine-v2`, and `/api/assistant` only).

## 10. P0 / P1 findings

### P0 (2)

- **`/api/enrich/batch`** — the only route whose single invocation can
  trigger multiple real AI calls in a loop (up to ~9 within its 54s
  budget), with no caller-facing rate limit and no budget guard, gated
  only by a non-constant-time shared-secret comparison.
- **`/api/reports/generate`** — writes to the `reports` table across 4
  distinct AI-calling code paths, and is the only route in this inventory
  missing the malformed-JSON `try/catch` guard present on every sibling
  manually-triggered route (a distinct, newly-discovered finding).

### P1 (8)

`/api/admin/simulate-engine-v2`, `/api/agent`, `/api/assistant`,
`/api/collect`, `/api/cron/momentum`, `/api/cron/pipeline`,
`/api/enrich`, `/api/events/promote` — see the full inventory JSON for
the specific reasoning behind each.

## 11. Weak-auth pattern (repository-wide finding)

Nine routes (`/api/collect`, `/api/cron/collect`, `/api/cron/enrich`,
`/api/cron/events`, `/api/cron/momentum`, `/api/cron/pipeline`,
`/api/cron/reports`, `/api/enrich/batch`, `/api/enrich`,
`/api/events/promote`, `/api/reports/generate`) each implement their own
local, duplicated `CRON_SECRET` check using a non-constant-time (`===`)
string comparison, rather than using the centralized, constant-time
`src/lib/security/api-access.ts` module established in Phase 1A. This is
a real, registered finding — not fixed in this PR (see Restrictions).

## 12. Phase 1A vs. remaining Phase 1 scope

**Already fixed (Phase 1A, PR #3, merged):**

- `/api/agent`: public GET → guarded POST, safe DTO, lazy privileged imports
- `/api/admin/simulate-engine-v2`: public GET → guarded POST, redacted errors, lazy privileged imports
- `/api/assistant`: unrestricted POST → guarded POST, forced-disabled in production, fail-closed environment matrix

**NOT fixed by Phase 1A, confirmed still open by this audit:**

- No rate limiting anywhere in the repository
- No budget/cost guard on any AI-calling route
- 9 routes still use a duplicated, non-constant-time `CRON_SECRET` check instead of the shared guard module
- 5 routes leak raw `error.message` content to callers
- `/api/reports/generate` lacks a malformed-JSON guard present on its siblings
- 3 cron routes (`/api/cron/collect`, `/api/cron/enrich`, `/api/cron/momentum`) remain unregistered/orphaned relative to `vercel.json`'s actual single cron entry — a pre-existing finding, reconfirmed here

This document does not claim any of the above are fixed. They are
findings only, registered for follow-up PRs.

---

## Restrictions

This PR does not change any production route handler's logic or
behavior. It adds only: the inventory JSON, this report, the checker
script and its tests, and a new CI step. No merge, deploy, Vercel
environment change, Supabase write, or migration was performed as part of
this task.
