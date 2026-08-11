-- AIscentra — production schema gate query
--
-- Real incident this closes: PR #45's code was released while
-- production's Supabase schema still matched the PRIOR release
-- (PR #44) -- 5 migrations were never applied. signals.has_verified_source
-- did not exist; every signal-listing query (which unconditionally
-- filters on that column) failed, and the public signal feed went
-- empty/errored.
--
-- Used by .github/workflows/production-release.yml's schema-check job
-- (via `psql -f`, avoiding any heredoc-in-YAML fragility) AND by
-- scripts/ci/schema-gate-test.sh (real PostgreSQL integration tests
-- proving this exact query correctly blocks an old schema and passes
-- a complete one) -- ONE query, two real consumers, so the gate that
-- actually runs in production is the exact same query verified by
-- tests, not a hand-copied approximation of it.
--
-- Every required table/column/function from this release's 5
-- migrations is listed explicitly, by name, so a future migration
-- that isn't added here is a visible, reviewable gap in this list,
-- not a silent one. Returns ZERO rows when the schema is complete;
-- each returned row is a human-readable description of exactly one
-- missing object.
WITH required_columns(table_name, column_name) AS (
  VALUES
    ('signals', 'verification_state'),
    ('signals', 'has_verified_source'),
    ('observations', 'url_verified_ok'),
    ('observations', 'url_verified_at'),
    ('pipeline_metrics', 'latency_p50_ms'),
    ('pipeline_metrics', 'latency_p95_ms'),
    ('pipeline_metrics', 'queue_depth'),
    ('pipeline_metrics', 'oldest_pending_age_seconds')
),
missing_columns AS (
  SELECT 'MISSING COLUMN: ' || rc.table_name || '.' || rc.column_name AS problem
  FROM required_columns rc
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = rc.table_name
      AND c.column_name = rc.column_name
  )
),
required_functions(function_name) AS (
  VALUES
    ('compute_verification_state'),
    ('compute_has_verified_source'),
    ('apply_signal_corroboration'),
    ('prune_pipeline_metrics')
),
missing_functions AS (
  SELECT 'MISSING FUNCTION: public.' || rf.function_name AS problem
  FROM required_functions rf
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.routines r
    WHERE r.routine_schema = 'public'
      AND r.routine_name = rf.function_name
  )
),
missing_tables AS (
  SELECT 'MISSING TABLE: public.pipeline_metrics' AS problem
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.tables t
    WHERE t.table_schema = 'public' AND t.table_name = 'pipeline_metrics'
  )
)
SELECT problem FROM missing_tables
UNION ALL
SELECT problem FROM missing_columns
UNION ALL
SELECT problem FROM missing_functions;
