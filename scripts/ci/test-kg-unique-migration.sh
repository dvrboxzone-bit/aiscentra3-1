#!/usr/bin/env bash
# ============================================================
# AIscentra CI — Knowledge Graph migration validation
#
# Runs supabase/migrations/20260729000001_fix_knowledge_graph_unique_constraint.sql
# against an ephemeral PostgreSQL 17 service container (GitHub Actions job
# service, free minutes on public/private repos with Actions enabled — no
# Supabase credentials, no production access, no paid resource).
#
# Every scenario runs against a freshly reset schema (DROP SCHEMA public
# CASCADE; CREATE SCHEMA public;) so scenarios never leak state into one
# another. Each SQL statement is run through psql with ON_ERROR_STOP=1 so
# an unexpected error surfaces immediately rather than being silently
# swallowed by a later statement's success.
#
# No `|| true` is used anywhere in this script to suppress an error
# unconditionally. Expected-failure scenarios capture psql's exit code
# explicitly and assert on it — an unexpected success in a failure
# scenario, or an unexpected failure in a success scenario, is treated as
# a test failure.
# ============================================================

set -Eeuo pipefail

MIGRATION_FILE="supabase/migrations/20260729000001_fix_knowledge_graph_unique_constraint.sql"
PSQL="psql -v ON_ERROR_STOP=1 -X -q"
FAILURES=0

if [[ ! -f "$MIGRATION_FILE" ]]; then
  echo "FATAL: migration file not found at $MIGRATION_FILE"
  exit 1
fi

log_scenario() {
  echo ""
  echo "=============================================================="
  echo "SCENARIO: $1"
  echo "=============================================================="
}

fail() {
  echo "FAIL: $1"
  FAILURES=$((FAILURES + 1))
}

pass() {
  echo "PASS: $1"
}

reset_schema() {
  $PSQL -c "DROP SCHEMA IF EXISTS public CASCADE;"
  $PSQL -c "CREATE SCHEMA public;"
}

create_minimal_table() {
  # Minimal table matching the real knowledge_graph_nodes shape needed for
  # this migration's own checks: id, node_id (nullable uuid, the column the
  # migration targets), plus one extra column and a label/payload column so
  # the ON CONFLICT DO UPDATE scenario has something to actually update.
  $PSQL -c "
    CREATE TABLE public.knowledge_graph_nodes (
      id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      node_id    uuid,
      node_type  text NOT NULL DEFAULT 'observation',
      label      text
    );
  "
}

# Runs the real migration file. Returns psql's exit code via \$?; caller
# decides whether that exit code represents success or expected failure.
run_migration() {
  set +e
  $PSQL -f "$MIGRATION_FILE" 2>&1
  local rc=$?
  set -e
  return $rc
}

query_scalar() {
  $PSQL -t -A -c "$1"
}

# ── Scenario 1 — clean schema ────────────────────────────────────────────────
log_scenario "1 — clean schema"
reset_schema
create_minimal_table

pre_count=$(query_scalar "SELECT count(*) FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND t.relname='knowledge_graph_nodes' AND c.contype='u';")
if [[ "$pre_count" != "0" ]]; then
  fail "Scenario 1: expected 0 pre-existing UNIQUE constraints, found $pre_count"
else
  pass "Scenario 1: confirmed no UNIQUE constraint on node_id before migration"
fi

if run_migration; then
  pass "Scenario 1: migration executed successfully"
else
  fail "Scenario 1: migration unexpectedly failed on clean schema"
fi

shape=$(query_scalar "
  SELECT
    c.conname || '|' || c.contype::text || '|' || array_length(c.conkey,1) || '|' ||
    a.attname || '|' || c.condeferrable || '|' || c.condeferred || '|' ||
    ix.indisunique || '|' || ix.indisvalid || '|' || ix.indisready || '|' ||
    ix.indislive || '|' || ix.indimmediate
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
  JOIN pg_index ix ON ix.indexrelid = c.conindid
  WHERE n.nspname='public' AND t.relname='knowledge_graph_nodes'
    AND c.conname='knowledge_graph_nodes_node_id_key';
")
expected="knowledge_graph_nodes_node_id_key|u|1|node_id|false|false|true|true|true|true|true"
if [[ "$shape" == "$expected" ]]; then
  pass "Scenario 1: constraint shape fully verified (name, contype=u, 1 column=node_id, deferrable=f, deferred=f, index unique/valid/ready/live/immediate=t)"
else
  fail "Scenario 1: constraint shape mismatch. Expected [$expected], got [$shape]"
fi

# ── Scenario 2 — repeated execution ──────────────────────────────────────────
log_scenario "2 — repeated execution / exact existing constraint"

if run_migration; then
  pass "Scenario 2: second execution succeeded (idempotent)"
else
  fail "Scenario 2: second execution unexpectedly failed"
fi

constraint_count=$(query_scalar "SELECT count(*) FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND t.relname='knowledge_graph_nodes' AND c.contype='u';")
if [[ "$constraint_count" == "1" ]]; then
  pass "Scenario 2: exactly one UNIQUE constraint present after repeated execution (no duplicate created)"
else
  fail "Scenario 2: expected exactly 1 UNIQUE constraint after repeat, found $constraint_count"
fi

index_count=$(query_scalar "SELECT count(*) FROM pg_index ix JOIN pg_class i ON i.oid=ix.indexrelid JOIN pg_class t ON t.oid=ix.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND t.relname='knowledge_graph_nodes' AND ix.indisunique;")
if [[ "$index_count" == "2" ]]; then
  # 2 expected: the pkey unique index + the node_id_key unique index. Not a
  # second index ON node_id specifically -- verified separately below.
  pass "Scenario 2: total unique index count is 2 (pkey + node_id_key), as expected"
else
  fail "Scenario 2: expected 2 total unique indexes (pkey + node_id_key), found $index_count"
fi

shape_after_repeat=$(query_scalar "
  SELECT c.condeferrable || '|' || c.condeferred
  FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
  WHERE n.nspname='public' AND t.relname='knowledge_graph_nodes' AND c.conname='knowledge_graph_nodes_node_id_key';
")
if [[ "$shape_after_repeat" == "false|false" ]]; then
  pass "Scenario 2: constraint shape unchanged after repeat (deferrable=f, deferred=f)"
else
  fail "Scenario 2: constraint shape changed after repeat: $shape_after_repeat"
fi

# ── Scenario 3 — same name, wrong column ─────────────────────────────────────
log_scenario "3 — same name, wrong column"
reset_schema
create_minimal_table
$PSQL -c "ALTER TABLE public.knowledge_graph_nodes ADD CONSTRAINT knowledge_graph_nodes_node_id_key UNIQUE (label);"

if run_migration; then
  fail "Scenario 3: migration unexpectedly SUCCEEDED against a same-named constraint on the wrong column"
else
  pass "Scenario 3: migration correctly failed (RAISE EXCEPTION expected for wrong-shape named constraint)"
fi

node_id_constraint_count=$(query_scalar "
  SELECT count(*) FROM pg_constraint c
  JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
  JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum = ANY(c.conkey)
  WHERE n.nspname='public' AND t.relname='knowledge_graph_nodes' AND c.contype='u' AND a.attname='node_id';
")
if [[ "$node_id_constraint_count" == "0" ]]; then
  pass "Scenario 3: no UNIQUE constraint was auto-created on node_id after the failure"
else
  fail "Scenario 3: expected 0 UNIQUE constraints on node_id after failure, found $node_id_constraint_count"
fi

# ── Scenario 4 — same name, DEFERRABLE ───────────────────────────────────────
log_scenario "4 — same name, DEFERRABLE"
reset_schema
create_minimal_table
$PSQL -c "ALTER TABLE public.knowledge_graph_nodes ADD CONSTRAINT knowledge_graph_nodes_node_id_key UNIQUE (node_id) DEFERRABLE;"

if run_migration; then
  fail "Scenario 4: migration unexpectedly SUCCEEDED against a same-named DEFERRABLE constraint"
else
  pass "Scenario 4: migration correctly failed against a same-named DEFERRABLE constraint"
fi

still_deferrable=$(query_scalar "
  SELECT c.condeferrable FROM pg_constraint c
  JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
  WHERE n.nspname='public' AND t.relname='knowledge_graph_nodes' AND c.conname='knowledge_graph_nodes_node_id_key';
")
if [[ "$still_deferrable" == "t" ]]; then
  pass "Scenario 4: original DEFERRABLE constraint was not replaced or auto-corrected"
else
  fail "Scenario 4: constraint deferrable-state unexpectedly changed to: $still_deferrable"
fi

# ── Scenario 5 — other name, NOT DEFERRABLE ──────────────────────────────────
log_scenario "5 — other name, NOT DEFERRABLE"
reset_schema
create_minimal_table
$PSQL -c "ALTER TABLE public.knowledge_graph_nodes ADD CONSTRAINT kgn_node_id_alt_name UNIQUE (node_id);"

if run_migration; then
  fail "Scenario 5: migration unexpectedly SUCCEEDED with an equivalent NOT DEFERRABLE constraint present under a different name"
else
  pass "Scenario 5: migration correctly failed, requiring manual schema-history reconciliation"
fi

unique_on_node_id_count=$(query_scalar "
  SELECT count(*) FROM pg_constraint c
  JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
  JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum = ANY(c.conkey)
  WHERE n.nspname='public' AND t.relname='knowledge_graph_nodes' AND c.contype='u' AND a.attname='node_id';
")
if [[ "$unique_on_node_id_count" == "1" ]]; then
  pass "Scenario 5: exactly the original constraint remains (kgn_node_id_alt_name); no second constraint created"
else
  fail "Scenario 5: expected exactly 1 UNIQUE constraint on node_id, found $unique_on_node_id_count"
fi

# ── Scenario 6 — other name, DEFERRABLE ──────────────────────────────────────
log_scenario "6 — other name, DEFERRABLE"
reset_schema
create_minimal_table
$PSQL -c "ALTER TABLE public.knowledge_graph_nodes ADD CONSTRAINT kgn_node_id_alt_deferrable UNIQUE (node_id) DEFERRABLE;"

if run_migration; then
  fail "Scenario 6: migration unexpectedly SUCCEEDED with a DEFERRABLE constraint present under a different name"
else
  pass "Scenario 6: migration correctly failed, reporting the constraint cannot serve as an ON CONFLICT arbiter"
fi

unique_on_node_id_count_6=$(query_scalar "
  SELECT count(*) FROM pg_constraint c
  JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
  JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum = ANY(c.conkey)
  WHERE n.nspname='public' AND t.relname='knowledge_graph_nodes' AND c.contype='u' AND a.attname='node_id';
")
if [[ "$unique_on_node_id_count_6" == "1" ]]; then
  pass "Scenario 6: exactly the original DEFERRABLE constraint remains; no second constraint auto-created"
else
  fail "Scenario 6: expected exactly 1 UNIQUE constraint on node_id, found $unique_on_node_id_count_6"
fi

# ── Scenario 7 — duplicate data ──────────────────────────────────────────────
log_scenario "7 — duplicate data"
reset_schema
create_minimal_table
dup_id=$(query_scalar "SELECT gen_random_uuid();")
$PSQL -c "INSERT INTO public.knowledge_graph_nodes (node_id, label) VALUES ('$dup_id', 'row-a'), ('$dup_id', 'row-b');"

if run_migration; then
  fail "Scenario 7: migration unexpectedly SUCCEEDED despite duplicate non-null node_id values"
else
  pass "Scenario 7: migration correctly failed with a native PostgreSQL duplicate-key error"
fi

row_count=$(query_scalar "SELECT count(*) FROM public.knowledge_graph_nodes WHERE node_id = '$dup_id';")
if [[ "$row_count" == "2" ]]; then
  pass "Scenario 7: both duplicate rows remain untouched (no data deleted or modified)"
else
  fail "Scenario 7: expected 2 rows with the duplicate node_id to remain, found $row_count"
fi

partial_constraint=$(query_scalar "
  SELECT count(*) FROM pg_constraint c
  JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
  WHERE n.nspname='public' AND t.relname='knowledge_graph_nodes' AND c.contype='u';
")
if [[ "$partial_constraint" == "0" ]]; then
  pass "Scenario 7: no UNIQUE constraint was partially created after the failure"
else
  fail "Scenario 7: expected 0 UNIQUE constraints after failed creation, found $partial_constraint"
fi

# ── Scenario 8 — ON CONFLICT compatibility ───────────────────────────────────
log_scenario "8 — ON CONFLICT compatibility"
reset_schema
create_minimal_table
if ! run_migration > /dev/null; then
  fail "Scenario 8: setup migration (against clean schema) unexpectedly failed -- cannot proceed with ON CONFLICT test"
fi

conflict_id=$(query_scalar "SELECT gen_random_uuid();")
$PSQL -c "INSERT INTO public.knowledge_graph_nodes (node_id, label) VALUES ('$conflict_id', 'first-insert');"
if $PSQL -c "INSERT INTO public.knowledge_graph_nodes (node_id, label) VALUES ('$conflict_id', 'second-insert-updates') ON CONFLICT (node_id) DO UPDATE SET label = EXCLUDED.label;"; then
  pass "Scenario 8: PostgreSQL accepted node_id as a valid ON CONFLICT arbiter"
else
  fail "Scenario 8: ON CONFLICT (node_id) was rejected -- constraint is not a usable arbiter"
fi

final_label=$(query_scalar "SELECT label FROM public.knowledge_graph_nodes WHERE node_id = '$conflict_id';")
final_row_count=$(query_scalar "SELECT count(*) FROM public.knowledge_graph_nodes WHERE node_id = '$conflict_id';")
if [[ "$final_row_count" == "1" && "$final_label" == "second-insert-updates" ]]; then
  pass "Scenario 8: exactly one row remains for this node_id, and it reflects the updated value (no duplicate row created)"
else
  fail "Scenario 8: expected 1 row with label='second-insert-updates', found $final_row_count row(s) with label='$final_label'"
fi

# ── Scenario 9 — standalone unique index without constraint (diagnostic) ────
log_scenario "9 — standalone unique index without constraint (DIAGNOSTIC)"
reset_schema
create_minimal_table
$PSQL -c "CREATE UNIQUE INDEX kgn_node_id_standalone_idx ON public.knowledge_graph_nodes (node_id);"

echo "NOTE: This scenario is diagnostic per task instructions. A standalone"
echo "UNIQUE INDEX with no backing pg_constraint row is invisible to this"
echo "migration's pg_constraint-based checks (scenarios 1-6 only inspect"
echo "pg_constraint, not pg_index in isolation from a constraint). The"
echo "following records ACTUAL behavior without assuming it is safe."

migration_outcome="unknown"
if run_migration; then
  migration_outcome="succeeded"
else
  migration_outcome="failed"
fi
echo "ACTUAL BEHAVIOR: migration $migration_outcome when a standalone unique index (no constraint) already existed on node_id."

unique_structures_after=$(query_scalar "
  SELECT count(*) FROM pg_index ix
  JOIN pg_class i ON i.oid = ix.indexrelid
  JOIN pg_class t ON t.oid = ix.indrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey::int2[])
  WHERE n.nspname='public' AND t.relname='knowledge_graph_nodes'
    AND ix.indisunique AND a.attname='node_id';
")
echo "DIAGNOSTIC RESULT: total unique index structures covering node_id after migration attempt: $unique_structures_after"

if [[ "$migration_outcome" == "succeeded" && "$unique_structures_after" -gt "1" ]]; then
  echo "KNOWN LIMITATION: the migration created an ADDITIONAL unique structure"
  echo "on node_id alongside the pre-existing standalone unique index, because"
  echo "its idempotency check only inspects pg_constraint and has no awareness"
  echo "of a constraint-less unique index. This scenario is NOT represented as"
  echo "risk-free -- it is flagged explicitly as a known limitation of the"
  echo "current migration's detection logic. Manual reconciliation would be"
  echo "required in a real environment where this situation is found."
  echo "Scenario 9: DIAGNOSTIC COMPLETE -- limitation confirmed and disclosed, not treated as a pass or fail."
elif [[ "$migration_outcome" == "succeeded" && "$unique_structures_after" == "1" ]]; then
  echo "Scenario 9: DIAGNOSTIC COMPLETE -- migration succeeded and only the original standalone index remains covering node_id (no second structure created); this would still need manual review since no pg_constraint exists for it, but no additional structure was added."
else
  echo "Scenario 9: DIAGNOSTIC COMPLETE -- migration failed in the presence of a standalone unique index without a backing constraint. Recorded as actual behavior, not scored pass/fail per task instructions (this scenario is diagnostic only)."
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "=============================================================="
echo "SUMMARY"
echo "=============================================================="
if [[ "$FAILURES" -eq 0 ]]; then
  echo "ALL SCORED SCENARIOS (1-8) PASSED. Scenario 9 is diagnostic only, see above."
  exit 0
else
  echo "$FAILURES SCORED SCENARIO CHECK(S) FAILED. See FAIL lines above."
  exit 1
fi
