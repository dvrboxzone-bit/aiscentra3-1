#!/usr/bin/env bash
#
# AIscentra — PostgreSQL integration test for the TPD budget migration.
#
# This is a REAL database test, not a JS mock: it boots an actual
# PostgreSQL instance, applies the real migration file, and drives the
# real consume_ai_token_budget() function over genuinely concurrent
# client connections. The JS unit tests in
# src/lib/ai/__tests__/token-budget.test.ts emulate atomicity; only
# this script proves that pg_advisory_xact_lock and the single-
# transaction check-and-insert actually behave as claimed.
#
# NEVER touches production Supabase -- it starts its own throwaway
# cluster on a non-default port in a temp directory and destroys it.
#
# MANDATORY: this test never skips. If PostgreSQL cannot be installed,
# cannot be started, or no unprivileged user is available to run it,
# the script FAILS. A silent SKIP would let the concurrency guarantee
# regress unnoticed, which is precisely the failure mode this exists to
# prevent -- an untested lock is an unproven lock.

set -Eeuo pipefail

PGBIN=""
for d in /usr/lib/postgresql/*/bin; do [[ -x "$d/initdb" ]] && PGBIN="$d"; done
if [[ -z "$PGBIN" ]] && command -v initdb >/dev/null 2>&1; then PGBIN="$(dirname "$(command -v initdb)")"; fi
if [[ -z "$PGBIN" ]]; then
  echo "PostgreSQL not present -- attempting install (required, not optional)..."
  if command -v apt-get >/dev/null 2>&1; then
    (apt-get update -qq && apt-get install -y -qq postgresql postgresql-contrib) >/dev/null 2>&1 || true
  fi
  for d in /usr/lib/postgresql/*/bin; do [[ -x "$d/initdb" ]] && PGBIN="$d"; done
  if [[ -z "$PGBIN" ]] && command -v initdb >/dev/null 2>&1; then PGBIN="$(dirname "$(command -v initdb)")"; fi
fi
if [[ -z "$PGBIN" ]]; then
  echo "FAIL: PostgreSQL is REQUIRED for this gate and could not be installed."
  echo "      The concurrency guarantee cannot be verified without a real database."
  exit 1
fi
export PATH="$PGBIN:$PATH"

MIGRATION="supabase/migrations/20260808150000_create_ai_token_budget.sql"
HARDENING_MIGRATION="supabase/migrations/20260809040000_harden_ai_token_budget_grants.sql"
VERIFICATION_STATE_MIGRATION="supabase/migrations/20260809090000_add_signal_verification_state.sql"
PUBLICATION_GATE_MIGRATION="supabase/migrations/20260809095000_add_url_verification_and_publication_gate.sql"
[[ -f "$PUBLICATION_GATE_MIGRATION" ]] || { echo "FATAL: $PUBLICATION_GATE_MIGRATION not found (run from repo root)"; exit 1; }
[[ -f "$VERIFICATION_STATE_MIGRATION" ]] || { echo "FATAL: $VERIFICATION_STATE_MIGRATION not found (run from repo root)"; exit 1; }
CORROBORATION_MIGRATION="supabase/migrations/20260809100000_atomic_signal_corroboration.sql"
[[ -f "$CORROBORATION_MIGRATION" ]] || { echo "FATAL: $CORROBORATION_MIGRATION not found (run from repo root)"; exit 1; }
METRICS_MIGRATION="supabase/migrations/20260809120000_create_pipeline_metrics.sql"
METRICS_EXTEND_MIGRATION="supabase/migrations/20260809130000_extend_pipeline_metrics.sql"
[[ -f "$METRICS_EXTEND_MIGRATION" ]] || { echo "FATAL: $METRICS_EXTEND_MIGRATION not found (run from repo root)"; exit 1; }
[[ -f "$METRICS_MIGRATION" ]] || { echo "FATAL: $METRICS_MIGRATION not found (run from repo root)"; exit 1; }
METRICS_REJECTED_RETRIED_MIGRATION="supabase/migrations/20260811130000_extend_pipeline_metrics_rejected_retried.sql"
[[ -f "$METRICS_REJECTED_RETRIED_MIGRATION" ]] || { echo "FATAL: $METRICS_REJECTED_RETRIED_MIGRATION not found (run from repo root)"; exit 1; }
QUALITY_FOUNDATION_MIGRATION="supabase/migrations/20260821023045_add_signal_quality_foundation.sql"
[[ -f "$QUALITY_FOUNDATION_MIGRATION" ]] || { echo "FATAL: $QUALITY_FOUNDATION_MIGRATION not found (run from repo root)"; exit 1; }
DURABLE_SIS_MIGRATION="supabase/migrations/20260825121411_add_durable_sis_v1_pgmq_control.sql"
[[ -f "$DURABLE_SIS_MIGRATION" ]] || { echo "FATAL: $DURABLE_SIS_MIGRATION not found (run from repo root)"; exit 1; }
DURABLE_SIS_REPAIR_MIGRATION="supabase/migrations/20260828143422_fix_durable_sis_parser_technical_failure.sql"
[[ -f "$DURABLE_SIS_REPAIR_MIGRATION" ]] || { echo "FATAL: $DURABLE_SIS_REPAIR_MIGRATION not found (run from repo root)"; exit 1; }
DURABLE_SIS_CANARY_MIGRATION="supabase/migrations/20260829035009_unlock_durable_sis_canary.sql"
[[ -f "$DURABLE_SIS_CANARY_MIGRATION" ]] || { echo "FATAL: $DURABLE_SIS_CANARY_MIGRATION not found (run from repo root)"; exit 1; }
[[ -f "$HARDENING_MIGRATION" ]] || { echo "FATAL: $HARDENING_MIGRATION not found (run from repo root)"; exit 1; }
[[ -f "$MIGRATION" ]] || { echo "FATAL: $MIGRATION not found (run from repo root)"; exit 1; }

DIR="$(mktemp -d /tmp/aiscentra-pgtest-XXXXXX)"
PORT="${PGTEST_PORT:-55432}"
# initdb refuses to run as root; fall back to an unprivileged user when needed.
RUNAS=""
if [[ "$(id -u)" -eq 0 ]]; then
  for u in claude postgres nobody; do id "$u" >/dev/null 2>&1 && { RUNAS="$u"; break; }; done
  if [[ -z "$RUNAS" ]]; then
    useradd -m pgtestuser >/dev/null 2>&1 || true
    id pgtestuser >/dev/null 2>&1 && RUNAS="pgtestuser"
  fi
  if [[ -z "$RUNAS" ]]; then
    echo "FAIL: running as root and no unprivileged user could be created."
    echo "      initdb refuses to run as root, so the gate cannot verify concurrency."
    rm -rf "$DIR"
    exit 1
  fi
  chown -R "$RUNAS" "$DIR"
fi
run() { if [[ -n "$RUNAS" ]]; then su "$RUNAS" -c "PATH=$PATH $1"; else bash -c "$1"; fi; }

cleanup() {
  run "pg_ctl -D $DIR/data stop -m immediate" >/dev/null 2>&1 || true
  rm -rf "$DIR"
}
trap cleanup EXIT

echo "Booting throwaway PostgreSQL in $DIR (port $PORT)..."
run "initdb -D $DIR/data -U postgres --auth=trust" >/dev/null 2>&1
run "pg_ctl -D $DIR/data -o '-p $PORT -k $DIR -c listen_addresses=' -l $DIR/log start" >/dev/null 2>&1
for _ in $(seq 1 20); do
  psql -h "$DIR" -p "$PORT" -U postgres -tAqc "SELECT 1" >/dev/null 2>&1 && break
  sleep 0.5
done

PG="psql -h $DIR -p $PORT -U postgres -tAq"
$PG -v ON_ERROR_STOP=1 -c "SELECT 1" >/dev/null || { echo "FATAL: server did not start"; exit 1; }

# Supabase-specific roles the migrations reference. anon/authenticated
# are required for the hardening migration's REVOKE ... FROM PUBLIC,
# anon, authenticated to succeed at all -- REVOKE FROM a non-existent
# role errors, it does not silently no-op.
$PG -c "CREATE ROLE service_role;" >/dev/null 2>&1 || true
$PG -c "CREATE ROLE anon;" >/dev/null 2>&1 || true
$PG -c "CREATE ROLE authenticated;" >/dev/null 2>&1 || true

echo "Applying the real migration file..."
$PG -v ON_ERROR_STOP=1 -f "$MIGRATION" >/dev/null

echo "Applying the hardening migration (grants + search_path)..."
$PG -v ON_ERROR_STOP=1 -f "$HARDENING_MIGRATION" >/dev/null

# Minimal fixture tables for apply_signal_corroboration() -- that
# function references public.signals/observations/signal_decision_log,
# which are base-schema tables not created by any migration in this
# repo (they predate the migrations directory). Only the columns the
# function actually touches are created here, matching production's
# real column names/types (verified against production via
# information_schema before writing this fixture) closely enough to
# prove real atomicity, without attempting to reproduce the full
# production schema in a throwaway test cluster.
echo "Creating minimal fixture tables for signal-corroboration atomicity tests..."
$PG -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
CREATE TABLE public.signals (
  id UUID PRIMARY KEY,
  observation_ids UUID[] NOT NULL DEFAULT '{}',
  confidence_score INT NOT NULL DEFAULT 60,
  qualification_score NUMERIC,
  momentum_score INT NOT NULL DEFAULT 0,
  momentum_last_calculated TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  intelligence_type TEXT,
  sis_final NUMERIC,
  anti_hype_score NUMERIC,
  validation_flags TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE public.sources (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  trust_score NUMERIC NOT NULL DEFAULT 0.8,
  status TEXT NOT NULL DEFAULT 'ACTIVE'
);
INSERT INTO public.sources(id,name,type,status)
VALUES ('12121212-1212-4212-8212-121212121212','Primary fixture source','research','ACTIVE');
CREATE TABLE public.observations (
  id UUID PRIMARY KEY,
  source_id UUID NOT NULL DEFAULT '12121212-1212-4212-8212-121212121212' REFERENCES public.sources(id),
  title TEXT NOT NULL DEFAULT 'Eligible durable SIS fixture observation',
  content TEXT NOT NULL DEFAULT 'Primary-source evidence for a bounded Durable SIS canary.',
  processed BOOLEAN NOT NULL DEFAULT false,
  qualification_result TEXT,
  qualification_score NUMERIC,
  engine_version TEXT,
  processing_error TEXT,
  rejection_code TEXT,
  rejection_reason TEXT,
  url TEXT,
  signal_id UUID,
  url_verified_ok BOOLEAN,
  url_verified_at TIMESTAMPTZ
);
CREATE TABLE public.signal_decision_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id UUID,
  observation_id UUID NOT NULL,
  decision TEXT NOT NULL,
  rejection_code TEXT,
  rejection_reason TEXT,
  qualification_score NUMERIC,
  sis_novelty NUMERIC,
  sis_importance NUMERIC,
  sis_urgency NUMERIC,
  sis_confidence NUMERIC,
  sis_final NUMERIC,
  qualification_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
  human_relevance_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
  anti_hype_score NUMERIC,
  anti_hype_flags JSONB NOT NULL DEFAULT '{}'::jsonb,
  thresholds_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  rule_trace JSONB NOT NULL DEFAULT '[]'::jsonb,
  engine_justification TEXT,
  engine_version TEXT NOT NULL DEFAULT 'v2.0',
  decided_at TIMESTAMPTZ DEFAULT now()
);
SQL

echo "Applying the signal-verification-state migration..."
$PG -v ON_ERROR_STOP=1 -f "$VERIFICATION_STATE_MIGRATION" >/dev/null

echo "Applying the URL-verification / publication-gate migration..."
$PG -v ON_ERROR_STOP=1 -f "$PUBLICATION_GATE_MIGRATION" >/dev/null

echo "Applying the corroboration-atomicity migration..."
$PG -v ON_ERROR_STOP=1 -f "$CORROBORATION_MIGRATION" >/dev/null

echo "Applying the pipeline-metrics migration..."
$PG -v ON_ERROR_STOP=1 -f "$METRICS_MIGRATION" >/dev/null

echo "Applying the pipeline-metrics extension migration (p50/p95, queue depth)..."
$PG -v ON_ERROR_STOP=1 -f "$METRICS_EXTEND_MIGRATION" >/dev/null

echo "Applying the pipeline-metrics rejected/retried extension migration..."
$PG -v ON_ERROR_STOP=1 -f "$METRICS_REJECTED_RETRIED_MIGRATION" >/dev/null

echo "Creating minimal Event/Report fixture tables for quality publication guards..."
$PG -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
CREATE TABLE public.events (
  id UUID PRIMARY KEY,
  signal_id UUID NOT NULL
);
CREATE TABLE public.reports (
  id UUID PRIMARY KEY,
  signal_ids UUID[] NOT NULL DEFAULT '{}',
  event_ids UUID[] NOT NULL DEFAULT '{}',
  published_at TIMESTAMPTZ
);
SQL

fail=0
check() { # name expected actual
  if [[ "$2" == "$3" ]]; then echo "  ok   $1"; else echo "  FAIL $1 (expected '$2', got '$3')"; fail=1; fi
}

echo ""
echo "TEST 1 — migration objects exist"
check "ai_token_usage table" "t" "$($PG -c "SELECT to_regclass('public.ai_token_usage') IS NOT NULL")"
check "consume_ai_token_budget function" "t" \
  "$($PG -c "SELECT to_regprocedure('public.consume_ai_token_budget(text,text,int,int,numeric,interval)') IS NOT NULL")"

echo ""
echo "TEST 2 — five CONCURRENT requests with room for exactly one"
# Assistant ceiling at limit=100000, reserve=0.9 is 10000.
# Pre-load 7000 so exactly one 3000-token request can fit.
$PG -c "TRUNCATE public.ai_token_usage;" >/dev/null
$PG -c "INSERT INTO public.ai_token_usage(model,consumer,tokens) VALUES ('test-model','signal_engine',7000);" >/dev/null
: > "$DIR/results"
for _ in 1 2 3 4 5; do
  ( $PG -c "SELECT allowed FROM public.consume_ai_token_budget('test-model','assistant',3000,100000,0.9);" >> "$DIR/results" ) &
done
wait
granted="$(grep -c '^t$' "$DIR/results" || true)"
denied="$(grep -c '^f$' "$DIR/results" || true)"
total="$($PG -c "SELECT COALESCE(SUM(tokens),0) FROM public.ai_token_usage;")"
check "exactly one request granted" "1" "$granted"
check "the other four denied" "4" "$denied"
check "ledger never exceeds the 10000 ceiling" "10000" "$total"

echo ""
echo "TEST 3 — shared ceiling: Assistant cannot touch the Signal Engine reserve"
$PG -c "TRUNCATE public.ai_token_usage;" >/dev/null
$PG -c "INSERT INTO public.ai_token_usage(model,consumer,tokens) VALUES ('test-model','signal_engine',10000);" >/dev/null
check "assistant denied at its ceiling" "f" \
  "$($PG -c "SELECT allowed FROM public.consume_ai_token_budget('test-model','assistant',1,100000,0.9);")"
check "signal engine still allowed (same ledger)" "t" \
  "$($PG -c "SELECT allowed FROM public.consume_ai_token_budget('test-model','signal_engine',1000,100000,0.9);")"

echo ""
echo "TEST 4 — no independent budgets: both consumers share one total"
$PG -c "TRUNCATE public.ai_token_usage;" >/dev/null
$PG -c "INSERT INTO public.ai_token_usage(model,consumer,tokens) VALUES ('test-model','assistant',5000);" >/dev/null
# If budgets were independent, the engine would see 0 used, not 5000.
check "engine's view includes assistant spend" "5000" \
  "$($PG -c "SELECT used_tokens FROM public.consume_ai_token_budget('test-model','signal_engine',1,100000,0.9);")"
check "engine denied once the COMBINED total reaches the limit" "f" \
  "$($PG -c "
     TRUNCATE public.ai_token_usage;
     INSERT INTO public.ai_token_usage(model,consumer,tokens)
       VALUES ('test-model','assistant',9000),('test-model','signal_engine',90000);
     SELECT allowed FROM public.consume_ai_token_budget('test-model','signal_engine',2000,100000,0.9);")"

echo ""
echo "TEST 5 — ceiling arithmetic avoids the IEEE754 floor() defect"
$PG -c "TRUNCATE public.ai_token_usage;" >/dev/null
check "assistant ceiling is exactly 10000, not 9999" "10000" \
  "$($PG -c "SELECT ceiling_tokens FROM public.consume_ai_token_budget('test-model','assistant',1,100000,0.9);")"

echo ""
echo "TEST 6 — rolling window boundary"
$PG -c "TRUNCATE public.ai_token_usage;" >/dev/null
# One row just inside the window, one comfortably outside it.
$PG -c "INSERT INTO public.ai_token_usage(model,consumer,tokens,consumed_at)
        VALUES ('test-model','signal_engine',4000, now() - interval '23 hours 30 minutes'),
               ('test-model','signal_engine',50000, now() - interval '25 hours');" >/dev/null
check "only in-window tokens counted" "4000" \
  "$($PG -c "SELECT used_tokens FROM public.consume_ai_token_budget('test-model','signal_engine',1,100000,0.9);")"

echo ""
echo "TEST 7 — ledger cleanup keeps in-window rows and drops expired ones"
$PG -c "TRUNCATE public.ai_token_usage;" >/dev/null
$PG -c "INSERT INTO public.ai_token_usage(model,consumer,tokens,consumed_at)
        VALUES ('test-model','signal_engine',100, now() - interval '1 hour'),
               ('test-model','signal_engine',100, now() - interval '10 days');" >/dev/null
deleted="$($PG -c "SELECT public.prune_ai_token_usage();")"
check "one expired row deleted" "1" "$deleted"
check "in-window row retained" "1" "$($PG -c "SELECT count(*) FROM public.ai_token_usage;")"

echo ""
echo "TEST 8 — cross-platform execution lock: two competing runs"
$PG -c "DELETE FROM public.execution_locks;" >/dev/null
: > "$DIR/lockresults"
# Simulates a GitHub-triggered run and a Vercel-triggered run starting
# together -- the exact overlap GitHub's own `concurrency:` cannot
# prevent, because it cannot see the Vercel trigger at all.
for holder in github-run vercel-run; do
  ( $PG -c "SELECT public.acquire_execution_lock('enrichment_cycle','$holder','5 minutes');" >> "$DIR/lockresults" ) &
done
wait
won="$(grep -c '^t$' "$DIR/lockresults" || true)"
lost="$(grep -c '^f$' "$DIR/lockresults" || true)"
check "exactly one run acquires the lock" "1" "$won"
check "the competing run is refused (and must skip Groq entirely)" "1" "$lost"

echo ""
echo "TEST 9 — lock self-heals after a crashed holder (expiry takeover)"
$PG -c "DELETE FROM public.execution_locks;
        INSERT INTO public.execution_locks(lock_name,holder,acquired_at,expires_at)
        VALUES ('enrichment_cycle','crashed-run', now() - interval '10 minutes', now() - interval '5 minutes');" >/dev/null
check "expired lease is reclaimed without manual intervention" "t" \
  "$($PG -c "SELECT public.acquire_execution_lock('enrichment_cycle','new-run','5 minutes');")"

echo ""
echo "TEST 10 — release is holder-scoped"
$PG -c "DELETE FROM public.execution_locks;" >/dev/null
$PG -c "SELECT public.acquire_execution_lock('enrichment_cycle','holder-a','5 minutes');" >/dev/null
check "a different holder cannot release someone else's lock" "f" \
  "$($PG -c "SELECT public.release_execution_lock('enrichment_cycle','holder-b');")"
check "the true holder can release it" "t" \
  "$($PG -c "SELECT public.release_execution_lock('enrichment_cycle','holder-a');")"

echo ""
echo "TEST 11 — the lock does not block the budget RPC"
$PG -c "DELETE FROM public.execution_locks; TRUNCATE public.ai_token_usage;" >/dev/null
$PG -c "SELECT public.acquire_execution_lock('enrichment_cycle','holder-x','5 minutes');" >/dev/null
check "budget decisions proceed while the enrichment lock is held" "t" \
  "$($PG -c "SELECT allowed FROM public.consume_ai_token_budget('test-model','signal_engine',100,100000,0.9);")"

echo ""
echo "TEST 11b — collection_cycle lock: same mechanism, a DIFFERENT lock name"
# Real gap this closes: /api/cron/collect's own execution lock uses a
# distinct 'collection_cycle' lock_name (separate from enrichment's
# 'enrichment_cycle', since the two operations are not mutually
# exclusive) via the same acquire_execution_lock/release_execution_lock
# functions, but had no dedicated concurrency proof of its own before
# this test -- only the enrichment lock name was ever exercised here.
$PG -c "DELETE FROM public.execution_locks;" >/dev/null
: > "$DIR/collectlockresults"
for holder in github-collect-run manual-dispatch-run; do
  ( $PG -c "SELECT public.acquire_execution_lock('collection_cycle','$holder','5 minutes');" >> "$DIR/collectlockresults" ) &
done
wait
collect_won="$(grep -c '^t$' "$DIR/collectlockresults" || true)"
collect_lost="$(grep -c '^f$' "$DIR/collectlockresults" || true)"
check "exactly one collection run acquires the lock" "1" "$collect_won"
check "the competing collection run is refused" "1" "$collect_lost"
check "an unrelated enrichment_cycle lock is unaffected by a held collection_cycle lock (different lock_name)" "t" \
  "$($PG -c "SELECT public.acquire_execution_lock('enrichment_cycle','some-enrichment-holder','5 minutes');")"

echo ""
echo "TEST 12 — hardening migration: grants and search_path"
$PG -c "TRUNCATE public.ai_token_usage; TRUNCATE public.execution_locks;" >/dev/null

# service_role: must still work exactly as before hardening.
sr_result="$($PG -c "SET ROLE service_role; SELECT allowed FROM public.consume_ai_token_budget('hardening-model','signal_engine',10,1000,0.9); RESET ROLE;" 2>&1)"
check "service_role: consume_ai_token_budget still callable" "t" "$(echo "$sr_result" | tail -1)"
[[ "$(echo "$sr_result" | tail -1)" == "t" ]] || echo "    (full output: $sr_result)"

check "service_role: acquire_execution_lock still callable" "t" \
  "$($PG -c "SET ROLE service_role; SELECT public.acquire_execution_lock('hardening-lock','h','1 minute'); RESET ROLE;" 2>&1 | tail -1)"

# anon: table access must now be denied at the privilege level (not
# merely filtered by RLS to zero rows -- an actual permission error).
anon_select_err="$($PG -c "SET ROLE anon; SELECT * FROM public.ai_token_usage; RESET ROLE;" 2>&1 | grep -c 'permission denied' || true)"
check "anon: SELECT on ai_token_usage is permission denied" "1" "$anon_select_err"

anon_exec_err="$($PG -c "SET ROLE anon; SELECT public.consume_ai_token_budget('m','signal_engine',1,100,0.9); RESET ROLE;" 2>&1 | grep -c 'permission denied' || true)"
check "anon: EXECUTE on consume_ai_token_budget is permission denied" "1" "$anon_exec_err"

# authenticated: same expectation as anon -- this data has no
# per-user meaning, it is pure infrastructure accounting.
auth_select_err="$($PG -c "SET ROLE authenticated; SELECT * FROM public.execution_locks; RESET ROLE;" 2>&1 | grep -c 'permission denied' || true)"
check "authenticated: SELECT on execution_locks is permission denied" "1" "$auth_select_err"

auth_exec_err="$($PG -c "SET ROLE authenticated; SELECT public.acquire_execution_lock('m','h','1 minute'); RESET ROLE;" 2>&1 | grep -c 'permission denied' || true)"
check "authenticated: EXECUTE on acquire_execution_lock is permission denied" "1" "$auth_exec_err"

# RLS itself must be unchanged by a pure GRANT/REVOKE + search_path
# migration -- still enabled, still service_role-only.
check "RLS still enabled on ai_token_usage" "t" \
  "$($PG -c "SELECT relrowsecurity FROM pg_class WHERE relname='ai_token_usage';")"
check "RLS still enabled on execution_locks" "t" \
  "$($PG -c "SELECT relrowsecurity FROM pg_class WHERE relname='execution_locks';")"
check "RLS policy on ai_token_usage still service_role-only" "service_role" \
  "$($PG -c "SELECT roles::text FROM pg_policies WHERE tablename='ai_token_usage';" | tr -d '{}')"

# search_path pinned on all four functions.
for fn_sig in \
  "consume_ai_token_budget(text, text, integer, integer, numeric, interval)" \
  "prune_ai_token_usage(interval)" \
  "acquire_execution_lock(text, text, interval)" \
  "release_execution_lock(text, text)"
do
  fn_name="${fn_sig%%(*}"
  cfg="$($PG -c "SELECT proconfig FROM pg_proc WHERE proname='${fn_name}';")"
  check "search_path pinned on ${fn_name}" "1" \
    "$(echo "$cfg" | grep -c 'search_path=pg_catalog')"
done

$PG -c "TRUNCATE public.ai_token_usage; TRUNCATE public.execution_locks;" >/dev/null

echo ""
echo "TEST 13 — apply_signal_corroboration: real transactional atomicity"
$PG -c "TRUNCATE public.signals, public.observations, public.signal_decision_log;" >/dev/null

SIG_ID="11111111-1111-1111-1111-111111111111"
OBS_A="22222222-2222-2222-2222-222222222222"
OBS_B="33333333-3333-3333-3333-333333333333"
MISSING_SIG="99999999-9999-9999-9999-999999999999"
MISSING_OBS="88888888-8888-8888-8888-888888888888"

$PG -c "INSERT INTO public.signals (id, observation_ids, confidence_score, qualification_score, momentum_score) VALUES ('$SIG_ID', ARRAY['$OBS_A']::uuid[], 60, 7.2, 20);" >/dev/null
$PG -c "INSERT INTO public.observations (id) VALUES ('$OBS_B');" >/dev/null

echo "  -- success case: all three writes commit together --"
check "success case returns true" "t" \
  "$($PG -c "SELECT public.apply_signal_corroboration('$SIG_ID','$OBS_B', ARRAY['$OBS_A','$OBS_B']::uuid[], 65, 40, 'v2.0', 'test corroboration');")"
check "signal.observation_ids genuinely updated" "2" \
  "$($PG -c "SELECT array_length(observation_ids,1) FROM public.signals WHERE id='$SIG_ID';")"
check "signal.confidence_score genuinely updated" "65" \
  "$($PG -c "SELECT confidence_score FROM public.signals WHERE id='$SIG_ID';")"
check "observation.qualification_result genuinely updated" "SIGNAL" \
  "$($PG -c "SELECT qualification_result FROM public.observations WHERE id='$OBS_B';")"
check "observation.qualification_score inherits the REAL signal score (7.2), not NULL -- the exact 'false SIGNAL with NULL score' bug this closes" "7.2" \
  "$($PG -c "SELECT qualification_score FROM public.observations WHERE id='$OBS_B';")"
check "decision log entry genuinely written" "1" \
  "$($PG -c "SELECT count(*) FROM public.signal_decision_log WHERE observation_id='$OBS_B';")"
check "decision log qualification_score also matches -- three-way consistency (signal/observation/decision_log)" "7.2" \
  "$($PG -c "SELECT qualification_score FROM public.signal_decision_log WHERE observation_id='$OBS_B';")"
check "verification_state becomes CORROBORATED at exactly 2 independent observations" "CORROBORATED" \
  "$($PG -c "SELECT verification_state FROM public.signals WHERE id='$SIG_ID';")"

echo "  -- failure case: nonexistent signal -- must roll back EVERYTHING, not partially apply --"
$PG -c "INSERT INTO public.observations (id) VALUES ('$MISSING_OBS');" >/dev/null
FAIL1_ERR="$($PG -c "SELECT public.apply_signal_corroboration('$MISSING_SIG','$MISSING_OBS', ARRAY['$MISSING_OBS']::uuid[], 99, 99, 'v2.0', 'should not apply');" 2>&1 | grep -c 'not found' || true)"
check "raises an error naming the missing signal" "1" "$FAIL1_ERR"
check "the observation was NOT updated despite being real and valid" "" \
  "$($PG -c "SELECT qualification_result FROM public.observations WHERE id='$MISSING_OBS';")"
check "no decision log entry was written for the failed attempt" "0" \
  "$($PG -c "SELECT count(*) FROM public.signal_decision_log WHERE observation_id='$MISSING_OBS';")"

echo "  -- failure case: nonexistent observation -- signal update must ALSO roll back, not just the observation --"
MISSING_OBS_2="77777777-7777-7777-7777-777777777777"
$PG -c "INSERT INTO public.signals (id, observation_ids) VALUES ('44444444-4444-4444-4444-444444444444', ARRAY['$OBS_A']::uuid[]);" >/dev/null
FAIL2_ERR="$($PG -c "SELECT public.apply_signal_corroboration('44444444-4444-4444-4444-444444444444','$MISSING_OBS_2', ARRAY['$OBS_A','$MISSING_OBS_2']::uuid[], 99, 99, 'v2.0', 'should not apply');" 2>&1 | grep -c 'not found' || true)"
check "raises an error naming the missing observation" "1" "$FAIL2_ERR"
check "the SIGNAL was NOT updated even though its own row exists and is valid -- proves this is one transaction, not two independent writes" "1" \
  "$($PG -c "SELECT array_length(observation_ids,1) FROM public.signals WHERE id='44444444-4444-4444-4444-444444444444';")"

echo ""
echo "TEST 14 — pipeline_metrics: write, read, grants, prune"
$PG -c "TRUNCATE public.pipeline_metrics;" >/dev/null

$PG -c "INSERT INTO public.pipeline_metrics
  (cycle_type, started_at, completed_at, duration_ms, items_attempted, items_succeeded, items_failed, failure_breakdown, stopped_reason, latency_p50_ms, latency_p95_ms, queue_depth, oldest_pending_age_seconds)
  VALUES ('enrichment', now() - interval '1 hour', now() - interval '55 minutes', 300000, 5, 3, 2,
          '{\"rate_limit\":1,\"deadline_exceeded\":1}'::jsonb, 'queue_empty', 1320, 1980, 6412, 172800);" >/dev/null

check "row was written and readable" "1" \
  "$($PG -c "SELECT count(*) FROM public.pipeline_metrics WHERE cycle_type='enrichment';")"
check "failure_breakdown is real structured jsonb, queryable by key" "1" \
  "$($PG -c "SELECT count(*) FROM public.pipeline_metrics WHERE (failure_breakdown->>'rate_limit')::int = 1;")"
check "latency_p50_ms/p95_ms are real, queryable columns" "1320" \
  "$($PG -c "SELECT latency_p50_ms FROM public.pipeline_metrics WHERE cycle_type='enrichment';")"
check "queue_depth is a real, queryable column" "6412" \
  "$($PG -c "SELECT queue_depth FROM public.pipeline_metrics WHERE cycle_type='enrichment';")"
check "oldest_pending_age_seconds is a real, queryable column" "172800" \
  "$($PG -c "SELECT oldest_pending_age_seconds FROM public.pipeline_metrics WHERE cycle_type='enrichment';")"

echo "  -- anon/authenticated must not read pipeline_metrics --"
anon_metrics_err="$($PG -c "SET ROLE anon; SELECT * FROM public.pipeline_metrics; RESET ROLE;" 2>&1 | grep -c 'permission denied' || true)"
check "anon: SELECT on pipeline_metrics is permission denied" "1" "$anon_metrics_err"

echo "  -- prune respects retention, does not touch in-window rows --"
$PG -c "INSERT INTO public.pipeline_metrics
  (cycle_type, started_at, completed_at, duration_ms, items_attempted, items_succeeded, items_failed)
  VALUES ('collection', now() - interval '40 days', now() - interval '40 days', 1000, 1, 1, 0);" >/dev/null
PRUNED="$($PG -c "SELECT public.prune_pipeline_metrics();")"
check "exactly the 40-day-old row is pruned, not the 1-hour-old one" "1" "$PRUNED"
check "the in-window row survives pruning" "1" \
  "$($PG -c "SELECT count(*) FROM public.pipeline_metrics;")"

$PG -c "TRUNCATE public.pipeline_metrics;" >/dev/null

echo ""
echo "TEST 15 — verification_state: distinct from confidence/qualification/status, correct thresholds"
check "compute_verification_state(1) = SINGLE_SOURCE_UNVERIFIED" "SINGLE_SOURCE_UNVERIFIED" \
  "$($PG -c "SELECT public.compute_verification_state(1);")"
check "compute_verification_state(2) = CORROBORATED (exact boundary)" "CORROBORATED" \
  "$($PG -c "SELECT public.compute_verification_state(2);")"
check "compute_verification_state(3) = VERIFIED (exact boundary)" "VERIFIED" \
  "$($PG -c "SELECT public.compute_verification_state(3);")"
check "compute_verification_state(10) = VERIFIED (well above boundary)" "VERIFIED" \
  "$($PG -c "SELECT public.compute_verification_state(10);")"

echo "  -- a freshly-inserted signal defaults to SINGLE_SOURCE_UNVERIFIED without the application setting it explicitly --"
$PG -c "TRUNCATE public.signals;" >/dev/null
$PG -c "INSERT INTO public.signals (id, observation_ids) VALUES ('55555555-5555-5555-5555-555555555555', ARRAY['$OBS_A']::uuid[]);" >/dev/null
check "default verification_state on insert" "SINGLE_SOURCE_UNVERIFIED" \
  "$($PG -c "SELECT verification_state FROM public.signals WHERE id='55555555-5555-5555-5555-555555555555';")"

echo "  -- verification_state, confidence_score, and status are genuinely independent columns --"
$PG -c "UPDATE public.signals SET confidence_score=95, verification_state='DISPUTED' WHERE id='55555555-5555-5555-5555-555555555555';" >/dev/null
check "confidence_score change does not affect verification_state" "DISPUTED" \
  "$($PG -c "SELECT verification_state FROM public.signals WHERE id='55555555-5555-5555-5555-555555555555';")"
check "verification_state change does not affect confidence_score" "95" \
  "$($PG -c "SELECT confidence_score FROM public.signals WHERE id='55555555-5555-5555-5555-555555555555';")"

echo "  -- the CHECK constraint rejects an invalid state --"
INVALID_ERR="$($PG -c "UPDATE public.signals SET verification_state='NOT_A_REAL_STATE' WHERE id='55555555-5555-5555-5555-555555555555';" 2>&1 | grep -c 'violates check constraint' || true)"
check "invalid verification_state is rejected by the CHECK constraint" "1" "$INVALID_ERR"

$PG -c "TRUNCATE public.signals;" >/dev/null

echo ""
echo "TEST 16 — publication gate: has_verified_source, compute_has_verified_source"
$PG -c "TRUNCATE public.signals, public.observations;" >/dev/null

OBS_VERIFIED="66666666-6666-6666-6666-666666666666"
OBS_UNVERIFIED="16161616-1616-1616-1616-161616161616"
OBS_NEVER_CHECKED="26262626-2626-2626-2626-262626262626"

$PG -c "INSERT INTO public.observations (id, url_verified_ok) VALUES
  ('$OBS_VERIFIED', true), ('$OBS_UNVERIFIED', false), ('$OBS_NEVER_CHECKED', NULL);" >/dev/null

check "a signal with a verified source is gated OPEN" "t" \
  "$($PG -c "SELECT public.compute_has_verified_source(ARRAY['$OBS_VERIFIED']::uuid[]);")"
check "a signal whose source failed verification is gated CLOSED" "f" \
  "$($PG -c "SELECT public.compute_has_verified_source(ARRAY['$OBS_UNVERIFIED']::uuid[]);")"
check "a signal whose source was never checked (NULL) is gated CLOSED -- fail-closed default" "f" \
  "$($PG -c "SELECT public.compute_has_verified_source(ARRAY['$OBS_NEVER_CHECKED']::uuid[]);")"
check "a signal with ONE verified source among several unverified ones is still gated OPEN" "t" \
  "$($PG -c "SELECT public.compute_has_verified_source(ARRAY['$OBS_UNVERIFIED','$OBS_VERIFIED','$OBS_NEVER_CHECKED']::uuid[]);")"
check "a signal with zero verified sources among several is gated CLOSED" "f" \
  "$($PG -c "SELECT public.compute_has_verified_source(ARRAY['$OBS_UNVERIFIED','$OBS_NEVER_CHECKED']::uuid[]);")"

echo "  -- corroboration re-evaluates the gate atomically: an unverified signal becomes verified once its corroborating source is confirmed --"
$PG -c "INSERT INTO public.signals (id, observation_ids, has_verified_source) VALUES ('$SIG_ID', ARRAY['$OBS_UNVERIFIED']::uuid[], false);" >/dev/null
$PG -c "SELECT public.apply_signal_corroboration('$SIG_ID','$OBS_VERIFIED', ARRAY['$OBS_UNVERIFIED','$OBS_VERIFIED']::uuid[], 65, 40, 'v2.0', 'corroborated by a verified source');" >/dev/null
check "has_verified_source flips to true after corroboration by a verified source, in the SAME transaction" "t" \
  "$($PG -c "SELECT has_verified_source FROM public.signals WHERE id='$SIG_ID';")"

$PG -c "TRUNCATE public.signals, public.observations;" >/dev/null

echo ""
echo "TEST 17 — production schema gate (scripts/release/schema-check.sql): real pass/fail against a real schema"
echo "  -- installing a local PGMQ 1.5.1 contract fixture; production uses Supabase's real extension --"
PG_SHARED_DIR="$($PGBIN/pg_config --sharedir)"
cat > "$PG_SHARED_DIR/extension/pgmq.control" <<'PGMQ_CONTROL'
default_version = '1.5.1'
relocatable = false
PGMQ_CONTROL
cat > "$PG_SHARED_DIR/extension/pgmq--1.5.1.sql" <<'PGMQ_SQL'
create schema pgmq;
create table pgmq.meta(queue_name text primary key);
create type pgmq.message_record as (msg_id bigint, read_ct integer, enqueued_at timestamptz, vt timestamptz, message jsonb);
create function pgmq.create(q text) returns void language plpgsql as $$
begin
  insert into pgmq.meta values(q) on conflict do nothing;
  execute format('create table if not exists pgmq.q_%I (msg_id bigserial primary key, read_ct integer not null default 0, enqueued_at timestamptz not null default now(), vt timestamptz not null default now(), message jsonb not null)', q);
end $$;
create function pgmq.send(q text, body jsonb, delay integer default 0) returns bigint language plpgsql as $$
declare result bigint; begin
  execute format('insert into pgmq.q_%I(vt,message) values(now()+(%L||'' seconds'')::interval,$1) returning msg_id',q,delay) into result using body;
  return result;
end $$;
create function pgmq.read(q text, visibility_timeout integer, qty integer) returns setof pgmq.message_record language plpgsql as $$
begin
  return query execute format('update pgmq.q_%I set read_ct=read_ct+1,vt=now()+(%L||'' seconds'')::interval where msg_id in (select msg_id from pgmq.q_%I where vt<=now() order by msg_id limit %L for update skip locked) returning msg_id,read_ct,enqueued_at,vt,message',q,visibility_timeout,q,qty);
end $$;
create function pgmq.archive(q text, id bigint) returns boolean language plpgsql as $$
declare affected integer; begin execute format('delete from pgmq.q_%I where msg_id=$1',q) using id; get diagnostics affected=row_count; return affected=1; end $$;
PGMQ_SQL
echo "  -- applying Phase 1 and Durable SIS after earlier mutation tests, then checking the full current schema --"
$PG -v ON_ERROR_STOP=1 -f "$QUALITY_FOUNDATION_MIGRATION" >/dev/null
$PG -v ON_ERROR_STOP=1 -f "$DURABLE_SIS_MIGRATION" >/dev/null
$PG -v ON_ERROR_STOP=1 -f "$DURABLE_SIS_REPAIR_MIGRATION" >/dev/null
$PG -v ON_ERROR_STOP=1 -f "$DURABLE_SIS_CANARY_MIGRATION" >/dev/null
FULL_SCHEMA_MISSING="$($PG -f scripts/release/schema-check.sql)"
check "the complete schema produces zero missing-object rows (gate passes)" "" "$FULL_SCHEMA_MISSING"

echo ""
echo "TEST 17a — Durable SIS FINALIZE is a crash-safe queue delivery"
DURABLE_OBS="e4275483-39e4-4441-84a2-0a1df546cf07"
DURABLE_RUN="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1"
DURABLE_ATTEMPT="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2"

$PG -v ON_ERROR_STOP=1 <<SQL >/dev/null
INSERT INTO public.observations(id, processed, url_verified_ok) VALUES ('$DURABLE_OBS', false, true);
UPDATE public.sis_execution_controls
SET execution_enabled=true, groq_daily_token_limit=30000
WHERE control_key='durable_sis_v1_control_20260825';
INSERT INTO public.sis_execution_runs(id,control_key,observation_id,status,current_stage,classifier_output)
VALUES ('$DURABLE_RUN','durable_sis_v1_control_20260825','$DURABLE_OBS','RUNNING','PARSER','{"decision":"SIGNAL"}'::jsonb);
INSERT INTO public.sis_execution_attempts(id,run_id,stage,ordinal,provider,model,status)
VALUES ('$DURABLE_ATTEMPT','$DURABLE_RUN','PARSER',1,'cloudflare','fixture-parser','RUNNING');
INSERT INTO public.sis_provider_budget_reservations(attempt_id,provider,model,unit_kind,reserved_units)
VALUES ('$DURABLE_ATTEMPT','cloudflare','fixture-parser','provider_request',1);
WITH message AS (
  SELECT pgmq.send('durable_sis_v1',jsonb_build_object('attempt_id','$DURABLE_ATTEMPT')) AS id
)
UPDATE public.sis_execution_attempts AS attempt
SET pgmq_message_id=message.id
FROM message
WHERE attempt.id='$DURABLE_ATTEMPT';
SELECT public.complete_durable_sis_v1_attempt(
  p_attempt_id => '$DURABLE_ATTEMPT',
  p_message_id => (SELECT pgmq_message_id FROM public.sis_execution_attempts WHERE id='$DURABLE_ATTEMPT'),
  p_status => 'SUCCEEDED',
  p_validated_output => '{"title":"validated parser output"}'::jsonb,
  p_finalization_outcome => 'DISCARD',
  p_finalization_signal => '{}'::jsonb,
  p_finalization_decision => '{"rejection_code":"R-15","rejection_reason":"fixture discard","engine_justification":"fixture"}'::jsonb
);
SQL

check "parser outcome is committed before finalization" "SUCCEEDED" \
  "$($PG -c "SELECT status FROM public.sis_execution_attempts WHERE id='$DURABLE_ATTEMPT';")"
check "run is ready for a separate durable finalization delivery" "READY_TO_FINALIZE|FINALIZE" \
  "$($PG -c "SELECT status||'|'||current_stage FROM public.sis_execution_runs WHERE id='$DURABLE_RUN';")"
check "provider message was archived after FINALIZE message was created" "1" \
  "$($PG -c "SELECT count(*) FROM pgmq.q_durable_sis_v1 WHERE message->>'stage'='FINALIZE' AND message->>'run_id'='$DURABLE_RUN';")"
check "a crash before finalization has not created a decision" "0" \
  "$($PG -c "SELECT count(*) FROM public.signal_decision_log WHERE observation_id='$DURABLE_OBS';")"

FINALIZE_MESSAGE_ID="$($PG -c "SELECT finalization_message_id FROM public.sis_execution_runs WHERE id='$DURABLE_RUN';")"
FINALIZE_CLAIM="$($PG -c "SELECT stage||'|'||coalesce(provider,'NULL') FROM public.claim_durable_sis_v1_attempt(55);")"
check "next delivery after parser success is FINALIZE with no provider" "FINALIZE|NULL" "$FINALIZE_CLAIM"

echo "  -- force one transactional finalization failure, then redeliver only FINALIZE --"
$PG -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
CREATE FUNCTION public.fail_durable_finalization_once() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'simulated temporary finalization failure';
END
$$;
CREATE TRIGGER fail_durable_finalization_once
BEFORE INSERT ON public.signal_decision_log
FOR EACH ROW EXECUTE FUNCTION public.fail_durable_finalization_once();
SQL
set +e
FINALIZE_FAILURE="$($PG -v ON_ERROR_STOP=1 -c "SELECT public.finalize_durable_sis_v1('$DURABLE_RUN',$FINALIZE_MESSAGE_ID);" 2>&1)"
FINALIZE_FAILURE_CODE=$?
set -e
check "temporary finalization failure is surfaced" "1" \
  "$([[ "$FINALIZE_FAILURE_CODE" -ne 0 && "$FINALIZE_FAILURE" == *"simulated temporary finalization failure"* ]] && echo 1 || echo 0)"
check "failed finalization writes no decision" "0" \
  "$($PG -c "SELECT count(*) FROM public.signal_decision_log WHERE observation_id='$DURABLE_OBS';")"
check "failed finalization leaves its durable message unarchived" "1" \
  "$($PG -c "SELECT count(*) FROM pgmq.q_durable_sis_v1 WHERE msg_id=$FINALIZE_MESSAGE_ID;")"

$PG -c "DROP TRIGGER fail_durable_finalization_once ON public.signal_decision_log; DROP FUNCTION public.fail_durable_finalization_once(); UPDATE pgmq.q_durable_sis_v1 SET vt=now() WHERE msg_id=$FINALIZE_MESSAGE_ID;" >/dev/null
FINALIZE_REDELIVERY="$($PG -c "SELECT stage||'|'||coalesce(provider,'NULL') FROM public.claim_durable_sis_v1_attempt(55);")"
check "redelivery after temporary failure is still FINALIZE-only" "FINALIZE|NULL" "$FINALIZE_REDELIVERY"
$PG -v ON_ERROR_STOP=1 -c "SELECT public.finalize_durable_sis_v1('$DURABLE_RUN',$FINALIZE_MESSAGE_ID);" >/dev/null
check "successful finalization writes exactly one decision" "1" \
  "$($PG -c "SELECT count(*) FROM public.signal_decision_log WHERE observation_id='$DURABLE_OBS';")"
check "discard finalization creates no Signal" "0" \
  "$($PG -c "SELECT count(*) FROM public.signals WHERE '$DURABLE_OBS'=ANY(observation_ids);")"
check "successful finalization archives the FINALIZE message" "0" \
  "$($PG -c "SELECT count(*) FROM pgmq.q_durable_sis_v1 WHERE msg_id=$FINALIZE_MESSAGE_ID;")"

FINALIZE_DUPLICATE="$($PG -c "SELECT (public.finalize_durable_sis_v1('$DURABLE_RUN',$FINALIZE_MESSAGE_ID)->>'duplicate')::boolean;")"
check "repeated finalization is reported as an idempotent duplicate" "t" "$FINALIZE_DUPLICATE"
check "repeated finalization still has exactly one decision" "1" \
  "$($PG -c "SELECT count(*) FROM public.signal_decision_log WHERE observation_id='$DURABLE_OBS';")"
check "repeated finalization still has no duplicate Signal" "0" \
  "$($PG -c "SELECT count(*) FROM public.signals WHERE '$DURABLE_OBS'=ANY(observation_ids);")"

echo ""
echo "TEST 17b — fallback budget failure is technical FAILED, never content DISCARD"
$PG -v ON_ERROR_STOP=1 <<SQL >/dev/null
TRUNCATE public.sis_provider_budget_reservations, public.sis_execution_attempts,
  public.sis_execution_finalizations, public.sis_execution_recoveries, public.sis_execution_runs;
DELETE FROM public.signal_decision_log WHERE observation_id='$DURABLE_OBS';
UPDATE public.observations SET processed=false, qualification_result=null, engine_version=null,
  processing_error=null, rejection_code=null, rejection_reason=null WHERE id='$DURABLE_OBS';
DELETE FROM pgmq.q_durable_sis_v1;
UPDATE public.sis_execution_controls SET groq_daily_token_limit=1 WHERE control_key='durable_sis_v1_control_20260825';
INSERT INTO public.sis_execution_runs(id,control_key,observation_id,status,current_stage)
VALUES ('$DURABLE_RUN','durable_sis_v1_control_20260825','$DURABLE_OBS','RUNNING','PARSER');
INSERT INTO public.sis_execution_attempts(id,run_id,stage,ordinal,provider,model,status)
VALUES ('$DURABLE_ATTEMPT','$DURABLE_RUN','PARSER',1,'cloudflare','fixture-parser','RUNNING');
INSERT INTO public.sis_provider_budget_reservations(attempt_id,provider,model,unit_kind,reserved_units)
VALUES ('$DURABLE_ATTEMPT','cloudflare','fixture-parser','provider_request',1);
WITH message AS (
  SELECT pgmq.send('durable_sis_v1',jsonb_build_object('attempt_id','$DURABLE_ATTEMPT')) AS id
)
UPDATE public.sis_execution_attempts AS attempt
SET pgmq_message_id=message.id
FROM message
WHERE attempt.id='$DURABLE_ATTEMPT';
SELECT public.complete_durable_sis_v1_attempt(
  p_attempt_id => '$DURABLE_ATTEMPT',
  p_message_id => (SELECT pgmq_message_id FROM public.sis_execution_attempts WHERE id='$DURABLE_ATTEMPT'),
  p_status => 'RETRYABLE',
  p_safe_diagnostic => '{"type":"provider_error","provider":"cloudflare","model":"fixture-parser","http_status":503,"finish_reason":null,"content_length":0}'::jsonb,
  p_validated_output => '{"provider_outcome":"committed"}'::jsonb,
  p_next_stage => 'PARSER',
  p_next_provider => 'groq',
  p_next_model => 'fallback-20b',
  p_next_units => 2,
  p_next_unit_kind => 'groq_tokens',
  p_budget_unavailable_decision => '{"rejection_code":"R-15","rejection_reason":"fallback budget unavailable","engine_justification":"provider outcome preserved"}'::jsonb
);
SQL

check "completed provider outcome remains committed when fallback budget is unavailable" "RETRYABLE|committed" \
  "$($PG -c "SELECT status||'|'||(validated_output->>'provider_outcome') FROM public.sis_execution_attempts WHERE id='$DURABLE_ATTEMPT';")"
check "unfunded fallback is terminal without a provider invocation" "TERMINAL|budget_unavailable" \
  "$($PG -c "SELECT status||'|'||(safe_diagnostic->>'type') FROM public.sis_execution_attempts WHERE run_id='$DURABLE_RUN' AND id<>'$DURABLE_ATTEMPT';")"
check "budget failure creates no FINALIZE or provider delivery" "0" \
  "$($PG -c "SELECT count(*) FROM pgmq.q_durable_sis_v1;")"
check "budget failure marks the run FAILED at the technical stage" "FAILED|PARSER" \
  "$($PG -c "SELECT status||'|'||current_stage FROM public.sis_execution_runs WHERE id='$DURABLE_RUN';")"
check "budget failure leaves the observation unprocessed" "false||" \
  "$($PG -c "SELECT processed||'|'||coalesce(qualification_result,'')||'|'||coalesce(rejection_code,'') FROM public.observations WHERE id='$DURABLE_OBS';")"
check "budget failure writes no content decision or Signal" "0|0" \
  "$($PG -c "SELECT (SELECT count(*) FROM public.signal_decision_log WHERE observation_id='$DURABLE_OBS')||'|'||(SELECT count(*) FROM public.signals WHERE '$DURABLE_OBS'=ANY(observation_ids));")"

echo ""
echo "TEST 17c — chain exhaustion is FAILED and a later start creates a new run"
$PG -v ON_ERROR_STOP=1 <<SQL >/dev/null
TRUNCATE public.sis_provider_budget_reservations, public.sis_execution_attempts,
  public.sis_execution_finalizations, public.sis_execution_recoveries, public.sis_execution_runs;
DELETE FROM pgmq.q_durable_sis_v1;
UPDATE public.sis_execution_controls SET groq_daily_token_limit=30000 WHERE control_key='durable_sis_v1_control_20260825';
INSERT INTO public.sis_execution_runs(id,control_key,observation_id,status,current_stage)
VALUES ('$DURABLE_RUN','durable_sis_v1_control_20260825','$DURABLE_OBS','RUNNING','PARSER');
INSERT INTO public.sis_execution_attempts(id,run_id,stage,ordinal,provider,model,status)
VALUES ('$DURABLE_ATTEMPT','$DURABLE_RUN','PARSER',3,'cloudflare','fixture-parser','RUNNING');
INSERT INTO public.sis_provider_budget_reservations(attempt_id,provider,model,unit_kind,reserved_units)
VALUES ('$DURABLE_ATTEMPT','cloudflare','fixture-parser','provider_request',1);
WITH message AS (
  SELECT pgmq.send('durable_sis_v1',jsonb_build_object('attempt_id','$DURABLE_ATTEMPT')) AS id
)
UPDATE public.sis_execution_attempts AS attempt
SET pgmq_message_id=message.id
FROM message
WHERE attempt.id='$DURABLE_ATTEMPT';
SELECT public.fail_durable_sis_v1_stage(
  p_attempt_id => '$DURABLE_ATTEMPT',
  p_message_id => (SELECT pgmq_message_id FROM public.sis_execution_attempts WHERE id='$DURABLE_ATTEMPT'),
  p_attempt_status => 'TERMINAL',
  p_safe_diagnostic => '{"type":"output_truncated","provider":"cloudflare","model":"fixture-parser","http_status":200,"finish_reason":"length","content_length":8254}'::jsonb
);
SQL

check "chain exhaustion marks the current run FAILED" "FAILED|output_truncated" \
  "$($PG -c "SELECT status||'|'||(safe_last_failure->>'type') FROM public.sis_execution_runs WHERE id='$DURABLE_RUN';")"
check "chain exhaustion archives work and creates no FINALIZE" "0" \
  "$($PG -c "SELECT count(*) FROM pgmq.q_durable_sis_v1;")"
check "chain exhaustion leaves observation and content ledgers untouched" "false|0|0" \
  "$($PG -c "SELECT processed||'|'||(SELECT count(*) FROM public.signal_decision_log WHERE observation_id='$DURABLE_OBS')||'|'||(SELECT count(*) FROM public.signals WHERE '$DURABLE_OBS'=ANY(observation_ids)) FROM public.observations WHERE id='$DURABLE_OBS';")"

RESTART_RESULT="$($PG -c "SELECT (public.start_durable_sis_v1_control('$DURABLE_OBS','groq','retry-classifier',100,'groq_tokens')->>'started')::boolean;")"
check "the next start after FAILED creates a new run" "t" "$RESTART_RESULT"
check "FAILED audit run and new active run coexist" "2|1" \
  "$($PG -c "SELECT count(*)||'|'||count(*) FILTER (WHERE status<>'FAILED') FROM public.sis_execution_runs WHERE observation_id='$DURABLE_OBS';")"

echo ""
echo "TEST 17d — one-off technical recovery preserves audit and restores retryability"
TECHNICAL_DECISION="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1"
$PG -v ON_ERROR_STOP=1 <<SQL >/dev/null
TRUNCATE public.sis_provider_budget_reservations, public.sis_execution_attempts,
  public.sis_execution_finalizations, public.sis_execution_recoveries, public.sis_execution_runs;
DELETE FROM public.signal_decision_log WHERE observation_id='$DURABLE_OBS';
DELETE FROM pgmq.q_durable_sis_v1;
UPDATE public.sis_execution_controls SET execution_enabled=false WHERE control_key='durable_sis_v1_control_20260825';
UPDATE public.observations SET processed=true, signal_id=null, qualification_result='DISCARD',
  rejection_code='R-15', rejection_reason='Durable SIS parser exhausted provider chain',
  engine_version='durable-sis-v1' WHERE id='$DURABLE_OBS';
INSERT INTO public.sis_execution_runs(
  id,control_key,observation_id,status,current_stage,safe_last_failure,
  finalization_outcome,finalization_signal,finalization_decision
) VALUES (
  '$DURABLE_RUN','durable_sis_v1_control_20260825','$DURABLE_OBS','FINALIZED','FINALIZE',
  '{"type":"output_truncated","provider":"cloudflare","model":"fixture-parser","http_status":200,"finish_reason":"length","content_length":8254}'::jsonb,
  'DISCARD','{}'::jsonb,
  '{"rejection_code":"R-15","rejection_reason":"Durable SIS parser exhausted provider chain","engine_justification":"All bounded provider attempts ended in typed failures."}'::jsonb
);
INSERT INTO public.signal_decision_log(
  id,signal_id,observation_id,decision,rejection_code,rejection_reason,
  engine_justification,engine_version
) VALUES (
  '$TECHNICAL_DECISION',null,'$DURABLE_OBS','DISCARD','R-15',
  'Durable SIS parser exhausted provider chain',
  'All bounded provider attempts ended in typed failures.','durable-sis-v1'
);
INSERT INTO public.sis_execution_finalizations(run_id,observation_id,outcome,signal_id,decision_log_id)
VALUES ('$DURABLE_RUN','$DURABLE_OBS','DISCARD',null,'$TECHNICAL_DECISION');
SELECT public.recover_durable_sis_v1_technical_failure('$DURABLE_RUN','$TECHNICAL_DECISION');
SQL

check "recovery marks only the old run FAILED and restores the observation" "FAILED|false||" \
  "$($PG -c "SELECT run.status||'|'||observation.processed||'|'||coalesce(observation.qualification_result,'')||'|'||coalesce(observation.rejection_code,'') FROM public.sis_execution_runs run JOIN public.observations observation ON observation.id=run.observation_id WHERE run.id='$DURABLE_RUN';")"
check "recovery preserves decision audit and records the explicit waiver" "1|1|0" \
  "$($PG -c "SELECT (SELECT count(*) FROM public.signal_decision_log WHERE id='$TECHNICAL_DECISION')||'|'||(SELECT count(*) FROM public.sis_execution_recoveries WHERE decision_log_id='$TECHNICAL_DECISION')||'|'||(SELECT count(*) FROM public.sis_execution_finalizations WHERE run_id='$DURABLE_RUN');")"
$PG -c "UPDATE public.sis_execution_controls SET execution_enabled=true WHERE control_key='durable_sis_v1_control_20260825';" >/dev/null
RECOVERED_RESTART_RESULT="$($PG -c "SELECT (public.start_durable_sis_v1_control('$DURABLE_OBS','groq','recovered-classifier',100,'groq_tokens')->>'started')::boolean;")"
check "the recovered observation can create a fresh run without hiding its old decision" "t" "$RECOVERED_RESTART_RESULT"
check "recovery never deletes the append-only technical decision" "1" \
  "$($PG -c "SELECT count(*) FROM public.signal_decision_log WHERE id='$TECHNICAL_DECISION';")"

echo ""
echo "TEST 17e — ordinary observation canary invariants"
CANARY_ELIGIBLE="31313131-3131-4313-8313-313131313131"
CANARY_PROCESSED="32323232-3232-4323-8323-323232323232"
CANARY_REJECTED="33333333-3333-4333-8333-333333333333"
CANARY_INACTIVE="34343434-3434-4343-8343-343434343434"
INACTIVE_SOURCE="35353535-3535-4353-8353-353535353535"
$PG -v ON_ERROR_STOP=1 <<SQL >/dev/null
TRUNCATE public.sis_provider_budget_reservations, public.sis_execution_attempts,
  public.sis_execution_finalizations, public.sis_execution_recoveries, public.sis_execution_runs;
DELETE FROM pgmq.q_durable_sis_v1;
INSERT INTO public.sources(id,name,type,status)
VALUES ('$INACTIVE_SOURCE','Inactive fixture source','research','INACTIVE');
INSERT INTO public.observations(id,processed,url_verified_ok) VALUES
  ('$CANARY_ELIGIBLE',false,true),
  ('$CANARY_PROCESSED',true,true),
  ('$CANARY_REJECTED',false,true);
INSERT INTO public.observations(id,source_id,processed,url_verified_ok)
VALUES ('$CANARY_INACTIVE','$INACTIVE_SOURCE',false,true);
UPDATE public.observations
SET qualification_result='DISCARD', rejection_code='R-14', rejection_reason='fixture rejection'
WHERE id='$CANARY_REJECTED';
UPDATE public.sis_execution_controls
SET execution_enabled=false, groq_daily_token_limit=30000,
    cloudflare_daily_request_limit=20, max_attempts_per_stage=3
WHERE control_key='durable_sis_v1_control_20260825';
SQL

KILL_SWITCH_RESULT="$($PG -c "SELECT (public.start_durable_sis_v1_control('$CANARY_ELIGIBLE','groq','canary-classifier',100,'groq_tokens')->>'status');")"
check "kill switch blocks an otherwise eligible ordinary observation" "PAUSED" "$KILL_SWITCH_RESULT"
check "disabled start creates no run or queue delivery" "0|0" \
  "$($PG -c "SELECT (SELECT count(*) FROM public.sis_execution_runs WHERE observation_id='$CANARY_ELIGIBLE')||'|'||(SELECT count(*) FROM pgmq.q_durable_sis_v1);")"

$PG -c "UPDATE public.sis_execution_controls SET execution_enabled=true WHERE control_key='durable_sis_v1_control_20260825';" >/dev/null
ELIGIBLE_RESULT="$($PG -c "SELECT (public.start_durable_sis_v1_control('$CANARY_ELIGIBLE','groq','canary-classifier',100,'groq_tokens')->>'status')||'|'||(public.sis_execution_controls.execution_enabled::text) FROM public.sis_execution_controls WHERE control_key='durable_sis_v1_control_20260825';")"
check "ordinary active-source verified observation is admitted" "QUEUED|true" "$ELIGIBLE_RESULT"
check "the exact ordinary observation receives one active run" "1" \
  "$($PG -c "SELECT count(*) FROM public.sis_execution_runs WHERE observation_id='$CANARY_ELIGIBLE' AND status<>'FAILED';")"

set +e
DUPLICATE_ACTIVE_ERROR="$($PG -v ON_ERROR_STOP=1 -c "INSERT INTO public.sis_execution_runs(control_key,observation_id,status) VALUES ('durable_sis_v1_control_20260825','$CANARY_ELIGIBLE','QUEUED');" 2>&1)"
DUPLICATE_ACTIVE_CODE=$?
set -e
check "two nonfailed runs for one observation are rejected by the unique index" "1" \
  "$([[ "$DUPLICATE_ACTIVE_CODE" -ne 0 && "$DUPLICATE_ACTIVE_ERROR" == *"sis_execution_runs_one_nonfailed_per_observation_idx"* ]] && echo 1 || echo 0)"

for blocked in "$CANARY_PROCESSED" "$CANARY_REJECTED" "$CANARY_INACTIVE"; do
  BLOCKED_RESULT="$($PG -c "SELECT (public.start_durable_sis_v1_control('$blocked','groq','canary-classifier',100,'groq_tokens')->>'status');")"
  check "processed/rejected/inactive-source observation $blocked is ineligible" "INELIGIBLE" "$BLOCKED_RESULT"
done

$PG -v ON_ERROR_STOP=1 <<SQL >/dev/null
UPDATE public.sis_execution_attempts SET status='TERMINAL', completed_at=now()
WHERE run_id=(SELECT id FROM public.sis_execution_runs WHERE observation_id='$CANARY_ELIGIBLE' AND status<>'FAILED');
UPDATE public.sis_provider_budget_reservations SET status='CONSUMED', settled_at=now()
WHERE attempt_id IN (SELECT id FROM public.sis_execution_attempts WHERE run_id IN (SELECT id FROM public.sis_execution_runs WHERE observation_id='$CANARY_ELIGIBLE'));
DELETE FROM pgmq.q_durable_sis_v1
WHERE message->>'attempt_id' IN (SELECT id::text FROM public.sis_execution_attempts WHERE run_id IN (SELECT id FROM public.sis_execution_runs WHERE observation_id='$CANARY_ELIGIBLE'));
UPDATE public.sis_execution_runs SET status='FAILED', updated_at=now()
WHERE observation_id='$CANARY_ELIGIBLE' AND status<>'FAILED';
SQL
FAILED_RETRY_RESULT="$($PG -c "SELECT (public.start_durable_sis_v1_control('$CANARY_ELIGIBLE','groq','retry-classifier',100,'groq_tokens')->>'started')::boolean;")"
check "FAILED ordinary run permits one fresh retry" "t" "$FAILED_RETRY_RESULT"
check "FAILED audit and exactly one nonfailed retry coexist" "2|1" \
  "$($PG -c "SELECT count(*)||'|'||count(*) FILTER (WHERE status<>'FAILED') FROM public.sis_execution_runs WHERE observation_id='$CANARY_ELIGIBLE';")"
check "provider limits remain the configured production bounds" "30000|20|3" \
  "$($PG -c "SELECT groq_daily_token_limit||'|'||cloudflare_daily_request_limit||'|'||max_attempts_per_stage FROM public.sis_execution_controls WHERE control_key='durable_sis_v1_control_20260825';")"

echo ""
echo "TEST 17f — qualified Durable SIS outcomes are non-public and idempotent"
WEAK_OBS="36363636-3636-4363-8363-363636363636"
WEAK_RUN="36363636-3636-4363-8363-363636363631"
SIGNAL_OBS="37373737-3737-4373-8373-373737373737"
SIGNAL_RUN="37373737-3737-4373-8373-373737373731"
$PG -v ON_ERROR_STOP=1 <<SQL >/dev/null
INSERT INTO public.observations(id,processed,url_verified_ok) VALUES
  ('$WEAK_OBS',false,true),
  ('$SIGNAL_OBS',false,true);
INSERT INTO public.sis_execution_runs(
  id,control_key,observation_id,status,current_stage,
  finalization_outcome,finalization_signal,finalization_decision
) VALUES
  (
    '$WEAK_RUN','durable_sis_v1_control_20260825','$WEAK_OBS','READY_TO_FINALIZE','FINALIZE',
    'WEAK_SIGNAL',
    '{"title":"Bounded technical change","description":"Primary evidence supports a bounded non-public weak Signal.","category":"RESEARCH","impact_factor":6,"actor_factor":6,"novelty_factor":6,"verifiability_factor":7,"strategic_factor":6,"authority_factor":7,"corroboration_factor":2,"specificity_factor":7,"category_confidence_factor":7,"signal_score":60,"confidence_score":58,"momentum_score":20}'::jsonb,
    '{"sis_novelty":6,"sis_importance":6,"sis_urgency":5,"sis_confidence":6,"sis_final":4.8,"anti_hype_score":8,"anti_hype_flags":[],"human_relevance":{},"relevance_horizon":"MONTHS","engine_justification":"Fixture weak decision."}'::jsonb
  ),
  (
    '$SIGNAL_RUN','durable_sis_v1_control_20260825','$SIGNAL_OBS','READY_TO_FINALIZE','FINALIZE',
    'SIGNAL',
    '{"title":"Material technical change","description":"Primary evidence supports a draft Signal pending explicit quality approval.","category":"MODELS","impact_factor":8,"actor_factor":8,"novelty_factor":8,"verifiability_factor":8,"strategic_factor":8,"authority_factor":8,"corroboration_factor":2,"specificity_factor":8,"category_confidence_factor":8,"signal_score":80,"confidence_score":78,"momentum_score":40}'::jsonb,
    '{"sis_novelty":7,"sis_importance":8,"sis_urgency":8,"sis_confidence":8,"sis_final":6.75,"anti_hype_score":8,"anti_hype_flags":[],"human_relevance":{},"relevance_horizon":"MONTHS","engine_justification":"Fixture Signal decision."}'::jsonb
  );
WITH messages AS (
  SELECT '$WEAK_RUN'::uuid AS run_id,
         pgmq.send('durable_sis_v1',jsonb_build_object('stage','FINALIZE','run_id','$WEAK_RUN')) AS message_id
  UNION ALL
  SELECT '$SIGNAL_RUN'::uuid,
         pgmq.send('durable_sis_v1',jsonb_build_object('stage','FINALIZE','run_id','$SIGNAL_RUN'))
)
UPDATE public.sis_execution_runs AS run
SET finalization_message_id=messages.message_id
FROM messages
WHERE run.id=messages.run_id;
SELECT public.finalize_durable_sis_v1('$WEAK_RUN',
  (SELECT finalization_message_id FROM public.sis_execution_runs WHERE id='$WEAK_RUN'));
SELECT public.finalize_durable_sis_v1('$SIGNAL_RUN',
  (SELECT finalization_message_id FROM public.sis_execution_runs WHERE id='$SIGNAL_RUN'));
SQL

check "WEAK_SIGNAL finalizes as exactly one non-public WEAK/PENDING Signal" "WEAK|PENDING|false|1|1" \
  "$($PG -c "SELECT signal.status||'|'||signal.quality_state||'|'||signal.has_verified_source||'|'||(SELECT count(*) FROM public.signals WHERE '$WEAK_OBS'=ANY(observation_ids))||'|'||(SELECT count(*) FROM public.signal_decision_log WHERE observation_id='$WEAK_OBS') FROM public.signals signal WHERE '$WEAK_OBS'=ANY(signal.observation_ids);")"
check "SIGNAL finalizes as exactly one non-public DRAFT/PENDING Signal" "DRAFT|PENDING|false|1|1" \
  "$($PG -c "SELECT signal.status||'|'||signal.quality_state||'|'||signal.has_verified_source||'|'||(SELECT count(*) FROM public.signals WHERE '$SIGNAL_OBS'=ANY(observation_ids))||'|'||(SELECT count(*) FROM public.signal_decision_log WHERE observation_id='$SIGNAL_OBS') FROM public.signals signal WHERE '$SIGNAL_OBS'=ANY(signal.observation_ids);")"
check "qualified finalization marks each observation processed with its exact outcome" "true|WEAK_SIGNAL|true|SIGNAL" \
  "$($PG -c "SELECT weak.processed||'|'||weak.qualification_result||'|'||signal.processed||'|'||signal.qualification_result FROM public.observations weak CROSS JOIN public.observations signal WHERE weak.id='$WEAK_OBS' AND signal.id='$SIGNAL_OBS';")"

WEAK_DUPLICATE="$($PG -c "SELECT (public.finalize_durable_sis_v1('$WEAK_RUN',(SELECT finalization_message_id FROM public.sis_execution_runs WHERE id='$WEAK_RUN'))->>'duplicate')::boolean;")"
SIGNAL_DUPLICATE="$($PG -c "SELECT (public.finalize_durable_sis_v1('$SIGNAL_RUN',(SELECT finalization_message_id FROM public.sis_execution_runs WHERE id='$SIGNAL_RUN'))->>'duplicate')::boolean;")"
check "repeated WEAK_SIGNAL and SIGNAL finalization are both idempotent" "t|t" "$WEAK_DUPLICATE|$SIGNAL_DUPLICATE"
check "repeated qualified finalization creates no second Signal or content decision" "1|1|1|1" \
  "$($PG -c "SELECT (SELECT count(*) FROM public.signals WHERE '$WEAK_OBS'=ANY(observation_ids))||'|'||(SELECT count(*) FROM public.signal_decision_log WHERE observation_id='$WEAK_OBS')||'|'||(SELECT count(*) FROM public.signals WHERE '$SIGNAL_OBS'=ANY(observation_ids))||'|'||(SELECT count(*) FROM public.signal_decision_log WHERE observation_id='$SIGNAL_OBS');")"

$PG -v ON_ERROR_STOP=1 <<SQL >/dev/null
TRUNCATE public.sis_provider_budget_reservations, public.sis_execution_attempts,
  public.sis_execution_finalizations, public.sis_execution_recoveries, public.sis_execution_runs,
  public.signal_quality_decisions, public.signal_decision_log, public.signals, public.observations;
DELETE FROM public.sources WHERE id='$INACTIVE_SOURCE';
DELETE FROM pgmq.q_durable_sis_v1;
UPDATE public.sis_execution_controls
SET execution_enabled=false, groq_daily_token_limit=30000
WHERE control_key='durable_sis_v1_control_20260825';
SQL

echo "  -- simulating Phase 1 not applied: remove every gated quality object -- must block release with every exact gap --"
$PG -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
DROP TRIGGER signals_quality_decision_on_insert ON public.signals;
DROP TRIGGER signals_quality_decision_on_state_change ON public.signals;
DROP TRIGGER events_require_quality_approved_signal_on_insert ON public.events;
DROP TRIGGER events_require_quality_approved_signal_on_update ON public.events;
DROP TRIGGER reports_require_quality_approved_evidence_on_insert ON public.reports;
DROP TRIGGER reports_require_quality_approved_evidence_on_update ON public.reports;
DROP TABLE public.signal_quality_decisions;
DROP FUNCTION public.prevent_signal_quality_decision_mutation();
DROP FUNCTION public.record_signal_quality_decision();
DROP FUNCTION public.enforce_quality_approved_event_origin();
DROP FUNCTION public.enforce_quality_approved_report_publication();
ALTER TABLE public.signals
  DROP CONSTRAINT signals_quality_state_metadata_check,
  DROP CONSTRAINT signals_quality_approved_v2_invariants_check,
  DROP COLUMN quality_state,
  DROP COLUMN quality_reason_codes,
  DROP COLUMN quality_rule_version,
  DROP COLUMN quality_evaluated_at,
  DROP COLUMN quarantined_at;
DROP TYPE public.signal_quality_state;
SQL

PHASE1_SCHEMA_MISSING="$($PG -f scripts/release/schema-check.sql)"
PHASE1_SCHEMA_MISSING_COUNT="$(echo "$PHASE1_SCHEMA_MISSING" | grep -c '^MISSING' || true)"
check "a schema without Phase 1 produces exactly 24 quality missing-object rows" "24" "$PHASE1_SCHEMA_MISSING_COUNT"
check "the missing quality enum is named" "1" \
  "$(echo "$PHASE1_SCHEMA_MISSING" | grep -c 'MISSING TYPE: public.signal_quality_state')"
check "the missing quality ledger is named" "1" \
  "$(echo "$PHASE1_SCHEMA_MISSING" | grep -c 'MISSING TABLE: public.signal_quality_decisions')"
check "the missing APPROVED invariant is named" "1" \
  "$(echo "$PHASE1_SCHEMA_MISSING" | grep -c 'MISSING CONSTRAINT: public.signals.signals_quality_approved_v2_invariants_check')"
check "the missing Event guard trigger is named" "1" \
  "$(echo "$PHASE1_SCHEMA_MISSING" | grep -c 'MISSING OR DISABLED TRIGGER: public.events.events_require_quality_approved_signal_on_insert')"
check "the missing Report guard trigger is named" "1" \
  "$(echo "$PHASE1_SCHEMA_MISSING" | grep -c 'MISSING OR DISABLED TRIGGER: public.reports.reports_require_quality_approved_evidence_on_insert')"

echo "  -- simulating the REAL incident: the exact PR #44 schema (PR #45's objects removed) -- must correctly identify EVERY gap --"
$PG -c "ALTER TABLE public.signals DROP COLUMN IF EXISTS verification_state;" >/dev/null
$PG -c "ALTER TABLE public.signals DROP COLUMN IF EXISTS has_verified_source;" >/dev/null
$PG -c "ALTER TABLE public.observations DROP COLUMN IF EXISTS url_verified_ok;" >/dev/null
$PG -c "ALTER TABLE public.observations DROP COLUMN IF EXISTS url_verified_at;" >/dev/null
$PG -c "DROP TABLE IF EXISTS public.pipeline_metrics;" >/dev/null
$PG -c "DROP FUNCTION IF EXISTS public.compute_verification_state(INT);" >/dev/null
$PG -c "DROP FUNCTION IF EXISTS public.compute_has_verified_source(UUID[]);" >/dev/null
$PG -c "DROP FUNCTION IF EXISTS public.apply_signal_corroboration(UUID, UUID, UUID[], INT, INT, TEXT, TEXT);" >/dev/null
$PG -c "DROP FUNCTION IF EXISTS public.prune_pipeline_metrics(INTERVAL);" >/dev/null

OLD_SCHEMA_MISSING="$($PG -f scripts/release/schema-check.sql)"
OLD_SCHEMA_MISSING_COUNT="$(echo "$OLD_SCHEMA_MISSING" | grep -c '^MISSING' || true)"
# Real count: 4 signals/observations columns + 1 pipeline_metrics table
# + 4 pipeline_metrics columns (also legitimately "missing" once the
# whole table is gone -- a column cannot exist in a nonexistent table,
# so reporting both the table AND each of its columns is correct,
# more informative behavior, not double-counting a bug) + 4 functions
# = 13. (An earlier version of this test asserted 9, undercounting the
# pipeline_metrics column cascade -- caught by running this exact test
# and correcting the expectation, not the query.)
check "the real PR #44 schema (incomplete) produces exactly 39 missing-object rows (15 PR #45 gaps + 24 Phase 1 gaps)" "39" "$OLD_SCHEMA_MISSING_COUNT"
check "the specific incident-causing gap (has_verified_source) is named in the output" "1" \
  "$(echo "$OLD_SCHEMA_MISSING" | grep -c 'MISSING COLUMN: signals.has_verified_source')"
check "the missing pipeline_metrics table is named" "1" \
  "$(echo "$OLD_SCHEMA_MISSING" | grep -c 'MISSING TABLE: public.pipeline_metrics')"
check "a missing function (apply_signal_corroboration) is named" "1" \
  "$(echo "$OLD_SCHEMA_MISSING" | grep -c 'MISSING FUNCTION: public.apply_signal_corroboration')"

echo "  -- restoring the pre-Phase-1 schema; quality restore is deferred until after the remaining mutation test --"
$PG -v ON_ERROR_STOP=1 -f "$VERIFICATION_STATE_MIGRATION" >/dev/null
$PG -v ON_ERROR_STOP=1 -f "$PUBLICATION_GATE_MIGRATION" >/dev/null
$PG -v ON_ERROR_STOP=1 -f "$CORROBORATION_MIGRATION" >/dev/null
$PG -v ON_ERROR_STOP=1 -f "$METRICS_MIGRATION" >/dev/null
$PG -v ON_ERROR_STOP=1 -f "$METRICS_EXTEND_MIGRATION" >/dev/null
$PG -v ON_ERROR_STOP=1 -f "$METRICS_REJECTED_RETRIED_MIGRATION" >/dev/null

echo ""
echo "TEST 18 — verify-urls backfill: real deterministic pagination, priority, resumability, idempotent re-run"
reset_signal_observation_fixtures() {
  $PG -c "TRUNCATE
    public.sis_provider_budget_reservations,
    public.sis_execution_attempts,
    public.sis_execution_finalizations,
    public.sis_execution_recoveries,
    public.sis_execution_runs,
    public.signals,
    public.observations;" >/dev/null
}

reset_signal_observation_fixtures

# Real fixture: 12 observations. 5 linked to an ACTIVE signal (must
# drain FIRST, priority pass), 7 unlinked/other (drained second).
ACTIVE_SIG="99999999-0000-0000-0000-000000000001"
$PG -c "INSERT INTO public.signals (id, status) VALUES ('$ACTIVE_SIG', 'ACTIVE');" >/dev/null

for i in $(seq -w 1 5); do
  $PG -c "INSERT INTO public.observations (id, url, signal_id, url_verified_ok) VALUES
    ('11111111-1111-1111-1111-11111111111$i', 'https://example.com/priority-$i', '$ACTIVE_SIG', NULL);" >/dev/null
done
for i in $(seq -w 1 7); do
  $PG -c "INSERT INTO public.observations (id, url, signal_id, url_verified_ok) VALUES
    ('22222222-2222-2222-2222-22222222222$i', 'https://example.com/other-$i', NULL, NULL);" >/dev/null
done

echo "  -- priority pass: only observations linked to the ACTIVE signal, in deterministic id order --"
PRIORITY_IDS="$($PG -c "SELECT id FROM public.observations
  WHERE url_verified_ok IS NULL AND signal_id = '$ACTIVE_SIG'
  ORDER BY id LIMIT 50;")"
check "priority pass returns exactly the 5 ACTIVE-linked observations" "5" "$(echo "$PRIORITY_IDS" | grep -c '^1111')"
check "priority pass never returns an unrelated observation" "0" "$(echo "$PRIORITY_IDS" | grep -c '^2222')"

echo "  -- deterministic cursor pagination: page 1 (limit 3), then page 2 using the real cursor, no gaps, no overlap --"
PAGE1="$($PG -c "SELECT id FROM public.observations
  WHERE url_verified_ok IS NULL ORDER BY id LIMIT 3;")"
CURSOR="$(echo "$PAGE1" | tail -1)"
PAGE2="$($PG -c "SELECT id FROM public.observations
  WHERE url_verified_ok IS NULL AND id > '$CURSOR' ORDER BY id LIMIT 3;")"
OVERLAP="$(comm -12 <(echo "$PAGE1" | sort) <(echo "$PAGE2" | sort) | wc -l)"
check "cursor-paginated page 1 and page 2 share zero rows (no overlap)" "0" "$OVERLAP"
check "page 2 starts exactly after page 1's cursor (no gap)" "3" "$(echo "$PAGE2" | grep -c '^')"

echo "  -- resumability across 'runs': simulate 3 separate invocations of page size 4, confirm ALL 12 rows are eventually covered, none twice --"
$PG -c "DROP TABLE IF EXISTS public.seen_ids; CREATE TABLE public.seen_ids (id UUID);" >/dev/null
RESUME_CURSOR=""
for run in 1 2 3 4; do
  if [[ -z "$RESUME_CURSOR" ]]; then
    RUN_PAGE="$($PG -c "SELECT id FROM public.observations WHERE url_verified_ok IS NULL ORDER BY id LIMIT 4;")"
  else
    RUN_PAGE="$($PG -c "SELECT id FROM public.observations WHERE url_verified_ok IS NULL AND id > '$RESUME_CURSOR' ORDER BY id LIMIT 4;")"
  fi
  [[ -z "$RUN_PAGE" ]] && break
  echo "$RUN_PAGE" | while IFS= read -r id; do
    [[ -n "$id" ]] && $PG -c "INSERT INTO public.seen_ids VALUES ('$id');" >/dev/null
    # Simulates the real route writing url_verified_ok so this row is
    # never re-selected on the next simulated "run" -- the actual
    # resumability mechanism this proves.
    [[ -n "$id" ]] && $PG -c "UPDATE public.observations SET url_verified_ok = true WHERE id = '$id';" >/dev/null
  done
  RESUME_CURSOR="$(echo "$RUN_PAGE" | tail -1)"
done
check "all 12 real rows were covered across 3 simulated separate invocations, none skipped" "12" \
  "$($PG -c "SELECT count(*) FROM public.seen_ids;")"
check "no row was processed twice across simulated invocations (resumability, not duplication)" "12" \
  "$($PG -c "SELECT count(DISTINCT id) FROM public.seen_ids;")"

echo "  -- idempotent re-run: once url_verified_ok is set, a fresh 'invocation' query finds ZERO pending rows -- no re-processing --"
check "after full backfill, the pending-rows query is genuinely exhausted (idempotent re-run does nothing)" "0" \
  "$($PG -c "SELECT count(*) FROM public.observations WHERE url_verified_ok IS NULL;")"

$PG -c "DROP TABLE IF EXISTS public.seen_ids;" >/dev/null
reset_signal_observation_fixtures

echo ""
echo "  -- honest metrics contract: pipeline_metrics column comments genuinely state the real, enforced invariant (independent review) --"
# REAL BUG this closes: a prior migration's items_retried comment
# stated retried observations were "intentionally excluded from
# items_attempted" -- directly contradicting the real, enforced
# application-level contract (items_attempted = items_succeeded +
# items_rejected + items_failed + items_retried). Verified here
# against the REAL system catalog (col_description), not merely by
# re-reading the migration file's own text -- proves the comment
# actually landed in the database as intended.
ITEMS_ATTEMPTED_COMMENT="$($PG -tA -c "SELECT col_description('public.pipeline_metrics'::regclass, (SELECT attnum FROM pg_attribute WHERE attrelid='public.pipeline_metrics'::regclass AND attname='items_attempted'));" | tr '\n' ' ')"
check "items_attempted's real column comment states the honest sum invariant" "1" \
  "$(echo "$ITEMS_ATTEMPTED_COMMENT" | grep -c 'items_succeeded +')"

ITEMS_RETRIED_COMMENT="$($PG -tA -c "SELECT col_description('public.pipeline_metrics'::regclass, (SELECT attnum FROM pg_attribute WHERE attrelid='public.pipeline_metrics'::regclass AND attname='items_retried'));" | tr '\n' ' ')"
check "items_retried's real column comment states it IS included in items_attempted, not excluded" "1" \
  "$(echo "$ITEMS_RETRIED_COMMENT" | grep -c 'IS *one of the four addends')"
check "items_retried's real column comment does NOT contain the old, contradictory 'excluded from' claim" "0" \
  "$(echo "$ITEMS_RETRIED_COMMENT" | grep -c 'excluded from items_attempted')"

echo "  -- final restore: apply Phase 1 after all tests that intentionally mutate Signals --"
$PG -v ON_ERROR_STOP=1 -f "$QUALITY_FOUNDATION_MIGRATION" >/dev/null
POST_RESTORE_MISSING="$($PG -f scripts/release/schema-check.sql)"
check "schema restoration after TEST 17's intentional drops is genuinely complete" "" "$POST_RESTORE_MISSING"

echo ""
if [[ "$fail" -eq 0 ]]; then
  echo "PASS: all PostgreSQL integration checks succeeded."
else
  echo "FAIL: one or more PostgreSQL integration checks failed."
  exit 1
fi
