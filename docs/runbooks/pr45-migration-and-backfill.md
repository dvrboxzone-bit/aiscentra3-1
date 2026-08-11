# Runbook: PR #45 schema migration + URL-verification backfill

## Real incident this responds to

PR #45's code was released to production while production's Supabase
schema still matched the prior release (PR #44). 5 migrations were
never applied. `signals.has_verified_source` did not exist;
`getSignals()`/`getSignalById()` unconditionally filter on that
column, so every signal-listing query failed and the public signal
feed went empty. Production was rolled back to PR #44
(`dpl_Hm1xmgqqdcHcEyoCZM4jW61xaicX`, SHA `0f134834`). At the time of
this runbook, `main` contains PR #45 (SHA `8ecd7e6c`) but the 5
migrations remain unapplied. Data is intact: 223 signals, 6,885
observations.

This runbook is the single, safe, reproducible procedure for closing
that gap -- migrations, then backfill, then verification, in that
order, with real checks at every step.

**This runbook does not itself apply anything to production.** It
documents the procedure; the actual execution is a separate, explicit
owner action (either manually, or by re-running the
`production-release.yml` workflow, whose new `schema-check` job will
refuse to proceed with a build/deploy until step 1 below is complete).

---

## Step 1 — apply the 5 pending migrations

Exactly these 5 files, in this exact order (the order is load-bearing:
`apply_signal_corroboration` in migration 3 references functions and
columns created by migrations 1-2):

```
supabase/migrations/20260809090000_add_signal_verification_state.sql
supabase/migrations/20260809095000_add_url_verification_and_publication_gate.sql
supabase/migrations/20260809100000_atomic_signal_corroboration.sql
supabase/migrations/20260809120000_create_pipeline_metrics.sql
supabase/migrations/20260809130000_extend_pipeline_metrics.sql
```

All 5 are idempotent (`ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT
EXISTS`, `CREATE OR REPLACE FUNCTION`) -- safe to re-run if a prior
attempt partially completed. All new `NOT NULL` columns carry a real
`DEFAULT` (`verification_state DEFAULT 'SINGLE_SOURCE_UNVERIFIED'`,
`has_verified_source DEFAULT false`), so applying them does not break
PR #44's own still-running INSERT statements during any rollout window
where old code and the new schema briefly coexist.

**Real consequence to expect immediately after this step, before
backfill runs**: every existing signal's `has_verified_source`
defaults to `false` (nothing has been verified yet). If PR #45's code
is deployed at this point, without backfill, the public feed will be
technically correct (no errors) but effectively EMPTY, since no signal
yet has a verified source. This is why Step 2 must run before -- or
immediately after, with the smoke gate blocking cutover until enough
of it has completed (see Step 4) -- code deployment, not treated as
optional cleanup.

Verification after this step: apply
`scripts/release/schema-check.sql` against production and confirm it
returns zero rows (this is the exact query the `schema-check` CI gate
runs).

## Step 2 — run the backfill (`POST /api/cron/verify-urls`)

The endpoint drains observations with `url_verified_ok IS NULL` in two
passes per invocation:

1. **Priority pass**: observations linked to a currently-`ACTIVE`
   signal, exhaustively paginated first (these directly gate what the
   public feed shows).
2. **General pass**: everything else, only if time budget remains.

Each invocation processes multiple pages (deterministically ordered by
`id`, real cursor pagination) until either the queue is empty or the
per-invocation time budget (`maxDuration=60`, minus a 10s buffer) is
exhausted. Resumability requires no special handling: `url_verified_ok`
stays `NULL` until a row is genuinely written, so a crashed or
timed-out invocation loses zero already-completed progress, and the
next invocation picks up exactly where the last one left off via its
own fresh cursor query.

For a full 6,885-observation backlog, expect multiple invocations to
be needed (real per-page cost is dominated by network latency to each
observation's source URL, not database time) -- the scheduled
`verify-urls-4h.yml` workflow (6x/day) will continue draining the
backlog automatically; a manual operator may also invoke the endpoint
directly (with a valid `CRON_SECRET`) to accelerate this for the
initial rollout specifically.

**This runbook does not run this step against production.** Real
PostgreSQL integration tests
(`scripts/ci/pg-integration-test.sh`, TEST 18) prove the pagination,
priority, resumability, and idempotency properties against a real
(throwaway) PostgreSQL instance instead.

## Step 3 — `has_verified_source` recompute

Handled automatically, inside the same endpoint invocation, for every
signal whose linked observation was just verified (via
`compute_has_verified_source`, the same PostgreSQL function used by
`apply_signal_corroboration`). **This never sets `has_verified_source
= true` without a genuinely verified, safe, reachable URL** --
`compute_has_verified_source` only returns `true` when at least one
linked observation has `url_verified_ok = true`, which is only ever
set by a real, completed `verifyUrlReachable()` call. No step in this
runbook or the backfill endpoint weakens or bypasses that rule.

## Step 4 — release-smoke verification (non-empty feed, not just HTTP 200)

Both the staged (pre-cutover) and post-cutover smoke checks in
`production-release.yml` now call `/api/signals` (or equivalent) and
assert the response is valid JSON **containing at least one signal**,
not merely a `200` status -- an empty-but-technically-successful
response is exactly the real incident's own failure mode, and a
bare-HTTP-200 check would not have caught it.

If the feed is still empty at cutover time (backfill has not yet
verified enough sources), the smoke gate fails closed and cutover does
not proceed -- re-run Step 2 (or wait for the next scheduled
`verify-urls-4h.yml` cycle) until enough signals have a verified
source, then retry the release.

## Rollback

If any step above surfaces an unexpected error, no destructive action
is required to revert: migrations are additive/idempotent (nothing is
dropped), and the backfill only ever transitions
`url_verified_ok` from `NULL` to a real boolean -- there is no data
loss path in this procedure. Reverting to the PR #44 deployment (as
already done once) remains available via the existing
Vercel-promotion mechanism at any point; the new schema is fully
backward-compatible with PR #44's own code (Step 1 above), so a
rollback does not require reverting the schema itself.
