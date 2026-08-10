-- ============================================================
-- Migration: 20260809120000_create_pipeline_metrics
--
-- Real gap this closes: the task required "измеримые ingestion/
-- processing/latency/failure metrics" -- before this migration, the
-- only place any of this data existed was ephemeral JSON in a cron
-- HTTP response body (enrich/batch's own BatchStats, cron/collect's
-- triggered/dispatchFailures counts), never persisted anywhere,
-- meaning there was no way to answer "how has throughput/failure rate
-- changed over time" without re-reading raw GitHub Actions logs.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.pipeline_metrics (
  id              BIGSERIAL PRIMARY KEY,

  -- Which pipeline stage this row measures.
  cycle_type      TEXT        NOT NULL CHECK (cycle_type IN ('collection', 'enrichment')),

  started_at      TIMESTAMPTZ NOT NULL,
  completed_at    TIMESTAMPTZ NOT NULL,
  duration_ms     INT         NOT NULL,

  -- Ingestion/processing counts. Meaning differs slightly by
  -- cycle_type (collection: sources attempted/observations saved;
  -- enrichment: observations processed/signals created) -- documented
  -- per-field in the application code that writes these, not
  -- re-encoded as separate columns per cycle type to keep this table
  -- simple and avoid a wide sparse schema.
  items_attempted INT         NOT NULL DEFAULT 0,
  items_succeeded INT         NOT NULL DEFAULT 0,
  items_failed    INT         NOT NULL DEFAULT 0,

  -- Structured failure-reason breakdown, e.g.
  -- {"rate_limit": 2, "budget_exhausted": 1, "deadline_exceeded": 0}.
  -- jsonb rather than fixed columns so the set of tracked reasons can
  -- grow (e.g. new AI error classes) without a further migration.
  failure_breakdown JSONB     NOT NULL DEFAULT '{}'::jsonb,

  -- Free-form stopped_reason / status for quick filtering without
  -- parsing failure_breakdown.
  stopped_reason  TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The only real query pattern: recent rows for a given cycle_type,
-- newest first (throughput/latency dashboards, "how many enrichment
-- cycles ran today").
CREATE INDEX IF NOT EXISTS idx_pipeline_metrics_type_time
  ON public.pipeline_metrics (cycle_type, started_at DESC);

ALTER TABLE public.pipeline_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role only" ON public.pipeline_metrics
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Same lockdown posture as this project's other new tables (hardening
-- migration 20260809040000): explicit REVOKE, not relying on the
-- absence of a GRANT, since Supabase's own schema-level defaults grant
-- broad privileges to anon/authenticated on new tables unless
-- explicitly revoked (confirmed as a real, present gap for this
-- project's earlier tables before that hardening pass).
REVOKE ALL ON public.pipeline_metrics FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.pipeline_metrics TO service_role;
REVOKE ALL ON SEQUENCE public.pipeline_metrics_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.pipeline_metrics_id_seq TO service_role;

COMMENT ON TABLE public.pipeline_metrics IS
  'Per-cycle ingestion/processing/latency/failure metrics for the
   collection and enrichment pipelines. One row per completed cycle
   (successful or not). Read via getRecentPipelineMetrics() in
   src/lib/metrics.ts.';

-- Retention: same reasoning as ai_token_usage's own prune function
-- (20260808150000) -- an append-only metrics table grows unbounded
-- otherwise. 30 days is far more history than any dashboard use case
-- in this project needs today, while still covering more than a full
-- month of throughput trend for manual review.
CREATE OR REPLACE FUNCTION public.prune_pipeline_metrics(
  p_retention INTERVAL DEFAULT '30 days'
)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
  v_deleted INT;
BEGIN
  DELETE FROM public.pipeline_metrics
  WHERE started_at < now() - p_retention;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.prune_pipeline_metrics(INTERVAL) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_pipeline_metrics(INTERVAL) TO service_role;
ALTER FUNCTION public.prune_pipeline_metrics(INTERVAL) SET search_path = pg_catalog;
