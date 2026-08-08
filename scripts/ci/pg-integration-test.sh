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
# Skips (exit 0) if PostgreSQL binaries are unavailable, so it can run
# in environments without them without failing the suite.

set -Eeuo pipefail

PGBIN=""
for d in /usr/lib/postgresql/*/bin; do [[ -x "$d/initdb" ]] && PGBIN="$d"; done
if [[ -z "$PGBIN" ]] && command -v initdb >/dev/null 2>&1; then PGBIN="$(dirname "$(command -v initdb)")"; fi
if [[ -z "$PGBIN" ]]; then
  echo "SKIP: no PostgreSQL binaries found; integration test not run."
  exit 0
fi
export PATH="$PGBIN:$PATH"

MIGRATION="supabase/migrations/20260808150000_create_ai_token_budget.sql"
[[ -f "$MIGRATION" ]] || { echo "FATAL: $MIGRATION not found (run from repo root)"; exit 1; }

DIR="$(mktemp -d /tmp/aiscentra-pgtest-XXXXXX)"
PORT="${PGTEST_PORT:-55432}"
# initdb refuses to run as root; fall back to an unprivileged user when needed.
RUNAS=""
if [[ "$(id -u)" -eq 0 ]]; then
  for u in claude postgres nobody; do id "$u" >/dev/null 2>&1 && { RUNAS="$u"; break; }; done
  [[ -n "$RUNAS" ]] || { echo "SKIP: running as root with no unprivileged user available."; rm -rf "$DIR"; exit 0; }
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

# Supabase-specific role the migration's RLS policy references.
$PG -c "CREATE ROLE service_role;" >/dev/null 2>&1 || true

echo "Applying the real migration file..."
$PG -v ON_ERROR_STOP=1 -f "$MIGRATION" >/dev/null

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
if [[ "$fail" -eq 0 ]]; then
  echo "PASS: all PostgreSQL integration checks succeeded."
else
  echo "FAIL: one or more PostgreSQL integration checks failed."
  exit 1
fi
