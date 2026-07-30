#!/usr/bin/env bash
# ============================================================
# AIscentra — Changed-Files Prettier Gate
#
# Transitional format gate: checks Prettier formatting ONLY on files
# changed relative to the merge-base with origin/main, not the entire
# repository. Repository-wide Prettier baseline currently contains legacy
# drift (106 files, confirmed via `npm run format:check` on main) — that
# repo-wide cleanup remains a separate, bounded task. This gate prevents
# NEW format violations from entering the codebase without requiring an
# immediate full-repo reformat.
#
# Fails loudly (non-zero exit) on any format violation among changed
# files. Never auto-formats. Never silently passes on error.
# ============================================================

set -Eeuo pipefail

BASE_REF="${1:-origin/main}"

if ! git rev-parse --verify "$BASE_REF" > /dev/null 2>&1; then
  echo "FATAL: base ref '$BASE_REF' not found. Fetch it first (e.g. git fetch origin main)."
  exit 1
fi

MERGE_BASE=$(git merge-base HEAD "$BASE_REF")
echo "Merge base with $BASE_REF: $MERGE_BASE"

# Added/Copied/Modified/Renamed files (excludes Deleted — nothing to format-check
# in a file that no longer exists) between merge-base and the working tree
# (including uncommitted changes, so this works pre-commit too).
mapfile -d '' -t CHANGED_FILES < <(
  git diff --name-only --diff-filter=ACMR -z "$MERGE_BASE" -- .
)

if [[ ${#CHANGED_FILES[@]} -eq 0 ]]; then
  echo "No changed files relative to $BASE_REF (merge-base $MERGE_BASE). Nothing to format-check."
  exit 0
fi

# Filter to Prettier-supported extensions only, and only files that still
# exist on disk (defensive — git diff --diff-filter=ACMR should already
# exclude deletions, but a file could have been moved/renamed away since).
SUPPORTED_EXTENSIONS_REGEX='\.(ts|tsx|js|jsx|mjs|cjs|json|css|scss|md|mdx|yml|yaml)$'
FILES_TO_CHECK=()
for f in "${CHANGED_FILES[@]}"; do
  if [[ -f "$f" ]] && [[ "$f" =~ $SUPPORTED_EXTENSIONS_REGEX ]]; then
    FILES_TO_CHECK+=("$f")
  fi
done

if [[ ${#FILES_TO_CHECK[@]} -eq 0 ]]; then
  echo "Changed files exist, but none have a Prettier-supported extension. Nothing to format-check."
  exit 0
fi

echo "Checking format on ${#FILES_TO_CHECK[@]} changed file(s):"
printf '  %s\n' "${FILES_TO_CHECK[@]}"
echo ""

# Pass filenames via -- to correctly handle any filename containing spaces
# or special characters (e.g. the [slug] directory names in this project).
npx prettier --check -- "${FILES_TO_CHECK[@]}"
EXIT_CODE=$?

if [[ $EXIT_CODE -ne 0 ]]; then
  echo ""
  echo "FAIL: one or more changed files violate Prettier formatting."
  echo "Repository-wide Prettier baseline currently contains legacy drift."
  echo "This gate only enforces formatting on files changed in this PR;"
  echo "repo-wide cleanup remains a separate bounded task."
fi

exit $EXIT_CODE
