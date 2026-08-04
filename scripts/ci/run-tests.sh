#!/usr/bin/env bash
# ============================================================
# AIscentra — Test Runner Wrapper
#
# Node's built-in test runner (`node --test`) exits 0 even when ZERO test
# files match the given glob — this would make "no tests" indistinguishable
# from "all tests passed", which is an explicitly forbidden outcome for
# this Quality Gate. This wrapper verifies at least one *.test.ts file
# actually exists (across an explicit allow-list of test directories, not
# a repo-wide glob) and was passed to node --test before running, and
# additionally parses the TAP summary to confirm `# tests` count is > 0
# after the run, failing loudly if either check comes up empty.
# ============================================================

set -Eeuo pipefail

# Real, newly-hit issue: src/modules/observations/__tests__/
# mark-observation-for-retry.test.ts imports the real
# src/modules/observations/queries.ts module (to exercise the actual
# markObservationForRetry function, not a reimplementation), which
# imports createAdminClient from @/lib/supabase/server, which imports
# config/env.ts -- whose top-level `export const env = {...}` throws
# immediately at module load if NEXT_PUBLIC_SUPABASE_URL/ANON_KEY are
# unset, regardless of whether any Supabase call is actually made (the
# test's own injectable-client parameter means no real Supabase
# connection is ever attempted). No prior test file in this project
# touched that import chain, so this was never previously needed.
# Dummy, non-secret placeholder values -- identical in shape to the
# ones already used for local `npm run build` throughout this
# project's own release workflow -- satisfy the module-load-time check
# without connecting to anything real.
export NEXT_PUBLIC_SUPABASE_URL="${NEXT_PUBLIC_SUPABASE_URL:-https://placeholder.supabase.co}"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="${NEXT_PUBLIC_SUPABASE_ANON_KEY:-test-anon-key-placeholder}"
export SUPABASE_SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-test-service-role-placeholder}"
export ADMIN_EMAIL="${ADMIN_EMAIL:-admin@placeholder.test}"

# Allowed test directories. Each new test area added to the project should
# be listed here explicitly — this is a deliberate allow-list, not a
# repo-wide glob, so an unrelated *.test.ts file accidentally created
# somewhere else in the tree does not silently get skipped OR silently
# get picked up without review of this list.
TEST_DIRS=(
  "supabase/functions/intelligence-agent/__tests__"
  "src/lib/security/__tests__"
  "scripts/release/__tests__"
  "src/modules/signals/__tests__"
  "src/lib/ai/__tests__"
  "src/modules/observations/__tests__"
  "src/app/api/enrich/batch/__tests__"
  "src/modules/assistant/__tests__"
)

TEST_FILES=()
for dir in "${TEST_DIRS[@]}"; do
  if [[ -d "$dir" ]]; then
    while IFS= read -r -d '' f; do
      TEST_FILES+=("$f")
    done < <(find "$dir" -name '*.test.ts' -type f -print0 2>/dev/null)
  fi
done

if [[ ${#TEST_FILES[@]} -eq 0 ]]; then
  echo "FATAL: zero test files found under any of: ${TEST_DIRS[*]}. Zero-test success is forbidden — failing explicitly."
  exit 1
fi

echo "Found ${#TEST_FILES[@]} test file(s):"
printf '  %s\n' "${TEST_FILES[@]}"
echo ""

OUTPUT_FILE=$(mktemp)
trap 'rm -f "$OUTPUT_FILE"' EXIT

set +e
node --import tsx --test "${TEST_FILES[@]}" 2>&1 | tee "$OUTPUT_FILE"
NODE_TEST_EXIT=${PIPESTATUS[0]}
set -e

TESTS_RUN=$(grep -oP '(?<=^# tests )\d+' "$OUTPUT_FILE" || echo "0")

if [[ "$TESTS_RUN" -eq 0 ]]; then
  echo ""
  echo "FATAL: node --test reported 0 tests executed despite ${#TEST_FILES[@]} test file(s) being present. Zero-test success is forbidden — failing explicitly."
  exit 1
fi

if [[ "$NODE_TEST_EXIT" -ne 0 ]]; then
  echo ""
  echo "FAIL: $TESTS_RUN test(s) ran, node --test reported failure(s). Exit code: $NODE_TEST_EXIT"
  exit "$NODE_TEST_EXIT"
fi

echo ""
echo "PASS: $TESTS_RUN test(s) ran successfully across ${#TEST_FILES[@]} file(s)."
exit 0
