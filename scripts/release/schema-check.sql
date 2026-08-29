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
-- scripts/ci/pg-integration-test.sh (real PostgreSQL integration tests
-- proving this exact query correctly blocks an old schema and passes
-- a complete one) -- ONE query, two real consumers, so the gate that
-- actually runs in production is the exact same query verified by
-- tests, not a hand-copied approximation of it.
--
-- Every required schema dependency from the release migrations is
-- listed explicitly, by name, so a future migration
-- that isn't added here is a visible, reviewable gap in this list,
-- not a silent one. Returns ZERO rows when the schema is complete;
-- each returned row is a human-readable description of exactly one
-- missing object.
WITH required_columns(table_name, column_name) AS (
  VALUES
    ('signals', 'verification_state'),
    ('signals', 'has_verified_source'),
    ('signals', 'quality_state'),
    ('signals', 'quality_reason_codes'),
    ('signals', 'quality_rule_version'),
    ('signals', 'quality_evaluated_at'),
    ('signals', 'quarantined_at'),
    ('observations', 'url_verified_ok'),
    ('observations', 'url_verified_at'),
    ('pipeline_metrics', 'latency_p50_ms'),
    ('pipeline_metrics', 'latency_p95_ms'),
    ('pipeline_metrics', 'queue_depth'),
    ('pipeline_metrics', 'oldest_pending_age_seconds'),
    ('pipeline_metrics', 'items_rejected'),
    ('pipeline_metrics', 'items_retried'),
    ('sis_execution_controls', 'execution_enabled'),
    ('sis_execution_controls', 'control_observation_id'),
    ('sis_execution_controls', 'groq_daily_token_limit'),
    ('sis_execution_controls', 'cloudflare_daily_request_limit'),
    ('sis_execution_controls', 'max_attempts_per_stage'),
    ('sis_execution_runs', 'finalization_outcome'),
    ('sis_execution_runs', 'finalization_signal'),
    ('sis_execution_runs', 'finalization_decision'),
    ('sis_execution_runs', 'finalization_message_id')
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
    ('prune_pipeline_metrics'),
    ('prevent_signal_quality_decision_mutation'),
    ('record_signal_quality_decision'),
    ('enforce_quality_approved_event_origin'),
    ('enforce_quality_approved_report_publication'),
    ('start_durable_sis_v1_control'),
    ('claim_durable_sis_v1_attempt'),
    ('reserve_durable_sis_v1_budget'),
    ('complete_durable_sis_v1_attempt'),
    ('fail_durable_sis_v1_stage'),
    ('recover_durable_sis_v1_technical_failure'),
    ('finalize_durable_sis_v1')
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
required_function_signatures(function_signature) AS (
  VALUES
    ('start_durable_sis_v1_control(uuid,text,text,integer,text)'),
    ('claim_durable_sis_v1_attempt(integer)'),
    ('complete_durable_sis_v1_attempt(uuid,bigint,text,jsonb,jsonb,text,text,text,integer,text,text,jsonb,jsonb,jsonb)'),
    ('fail_durable_sis_v1_stage(uuid,bigint,text,jsonb,jsonb)'),
    ('recover_durable_sis_v1_technical_failure(uuid,uuid)'),
    ('finalize_durable_sis_v1(uuid,bigint)')
),
missing_function_signatures AS (
  SELECT 'MISSING FUNCTION SIGNATURE: public.' || rfs.function_signature AS problem
  FROM required_function_signatures rfs
  WHERE to_regprocedure('public.' || rfs.function_signature) IS NULL
),
required_tables(table_name) AS (
  VALUES
    ('pipeline_metrics'),
    ('signal_quality_decisions'),
    ('sis_execution_controls'),
    ('sis_execution_runs'),
    ('sis_execution_attempts'),
    ('sis_provider_budget_reservations'),
    ('sis_execution_finalizations'),
    ('sis_execution_recoveries')
),
missing_tables AS (
  SELECT 'MISSING TABLE: public.' || rt.table_name AS problem
  FROM required_tables rt
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.tables t
    WHERE t.table_schema = 'public' AND t.table_name = rt.table_name
  )
),
required_types(type_name) AS (
  VALUES ('signal_quality_state')
),
missing_types AS (
  SELECT 'MISSING TYPE: public.' || rt.type_name AS problem
  FROM required_types rt
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = rt.type_name
  )
),
required_enum_values(type_name, enum_label) AS (
  VALUES
    ('signal_quality_state', 'PENDING'),
    ('signal_quality_state', 'APPROVED'),
    ('signal_quality_state', 'QUARANTINED')
),
missing_enum_values AS (
  SELECT 'MISSING ENUM VALUE: public.' || rev.type_name || '.' || rev.enum_label AS problem
  FROM required_enum_values rev
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE n.nspname = 'public'
      AND t.typname = rev.type_name
      AND e.enumlabel = rev.enum_label
  )
),
required_constraints(table_name, constraint_name) AS (
  VALUES
    ('signals', 'signals_quality_state_metadata_check'),
    ('signals', 'signals_quality_approved_v2_invariants_check'),
    ('sis_execution_controls', 'sis_execution_controls_groq_daily_token_limit_check'),
    ('sis_execution_controls', 'sis_execution_controls_cloudflare_daily_request_limit_check'),
    ('sis_execution_controls', 'sis_execution_controls_max_attempts_per_stage_check')
),
missing_constraints AS (
  SELECT 'MISSING CONSTRAINT: public.' || rc.table_name || '.' || rc.constraint_name AS problem
  FROM required_constraints rc
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class rel ON rel.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = rel.relnamespace
    WHERE n.nspname = 'public'
      AND rel.relname = rc.table_name
      AND c.conname = rc.constraint_name
  )
),
required_triggers(table_name, trigger_name) AS (
  VALUES
    ('signal_quality_decisions', 'signal_quality_decisions_no_update_delete'),
    ('signal_quality_decisions', 'signal_quality_decisions_no_truncate'),
    ('signals', 'signals_quality_decision_on_insert'),
    ('signals', 'signals_quality_decision_on_state_change'),
    ('events', 'events_require_quality_approved_signal_on_insert'),
    ('events', 'events_require_quality_approved_signal_on_update'),
    ('reports', 'reports_require_quality_approved_evidence_on_insert'),
    ('reports', 'reports_require_quality_approved_evidence_on_update')
),
missing_triggers AS (
  SELECT 'MISSING OR DISABLED TRIGGER: public.' || rt.table_name || '.' || rt.trigger_name AS problem
  FROM required_triggers rt
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class rel ON rel.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = rel.relnamespace
    WHERE n.nspname = 'public'
      AND rel.relname = rt.table_name
      AND t.tgname = rt.trigger_name
      AND NOT t.tgisinternal
      AND t.tgenabled <> 'D'
  )
),
missing_extensions AS (
  SELECT 'MISSING EXTENSION: pgmq' AS problem
  WHERE NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgmq')
),
missing_queues AS (
  SELECT 'MISSING QUEUE: durable_sis_v1' AS problem
  WHERE to_regclass('pgmq.q_durable_sis_v1') IS NULL
),
durable_sis_invariant_problems AS (
  SELECT 'FORBIDDEN FIXED-ID CONSTRAINT: public.' || rel.relname || '.' || constraint_row.conname AS problem
  FROM pg_constraint constraint_row
  JOIN pg_class rel ON rel.oid = constraint_row.conrelid
  JOIN pg_namespace namespace_row ON namespace_row.oid = rel.relnamespace
  WHERE namespace_row.nspname = 'public'
    AND constraint_row.conname IN (
      'sis_execution_controls_control_observation_id_check',
      'sis_execution_runs_observation_id_check'
    )
  UNION ALL
  SELECT 'MISSING INVARIANT: one nonfailed Durable SIS run per observation'
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_index index_row
    JOIN pg_class index_relation ON index_relation.oid = index_row.indexrelid
    JOIN pg_class table_relation ON table_relation.oid = index_row.indrelid
    JOIN pg_namespace namespace_row ON namespace_row.oid = table_relation.relnamespace
    WHERE namespace_row.nspname = 'public'
      AND table_relation.relname = 'sis_execution_runs'
      AND index_relation.relname = 'sis_execution_runs_one_nonfailed_per_observation_idx'
      AND index_row.indisunique
      AND index_row.indnkeyatts = 1
      AND (
        SELECT attribute_row.attname
        FROM pg_attribute attribute_row
        WHERE attribute_row.attrelid = table_relation.oid
          AND attribute_row.attnum = index_row.indkey[0]
      ) = 'observation_id'
      AND pg_get_expr(index_row.indpred, index_row.indrelid) = '(status <> ''FAILED''::text)'
  )
  UNION ALL
  SELECT 'FORBIDDEN LEGACY FUNCTION SIGNATURE: public.start_durable_sis_v1_control(text,text,integer,text)'
  WHERE to_regprocedure('public.start_durable_sis_v1_control(text,text,integer,text)') IS NOT NULL
)
SELECT problem FROM missing_tables
UNION ALL
SELECT problem FROM missing_columns
UNION ALL
SELECT problem FROM missing_functions
UNION ALL
SELECT problem FROM missing_function_signatures
UNION ALL
SELECT problem FROM missing_types
UNION ALL
SELECT problem FROM missing_enum_values
UNION ALL
SELECT problem FROM missing_constraints
UNION ALL
SELECT problem FROM missing_triggers
UNION ALL
SELECT problem FROM missing_extensions
UNION ALL
SELECT problem FROM missing_queues
UNION ALL
SELECT problem FROM durable_sis_invariant_problems;
