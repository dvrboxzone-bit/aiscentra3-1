-- ============================================================
-- Migration: 20260809130000_extend_pipeline_metrics
--
-- Real gap: pipeline_metrics (20260809120000) recorded aggregate
-- duration_ms per CYCLE, but no per-item latency distribution (a
-- single slow observation was invisible inside an average), and no
-- queue-depth/oldest-pending-age snapshot at all -- both explicitly
-- required.
-- ============================================================

ALTER TABLE public.pipeline_metrics
  ADD COLUMN IF NOT EXISTS latency_p50_ms INT,
  ADD COLUMN IF NOT EXISTS latency_p95_ms INT,
  ADD COLUMN IF NOT EXISTS queue_depth INT,
  ADD COLUMN IF NOT EXISTS oldest_pending_age_seconds INT;

COMMENT ON COLUMN public.pipeline_metrics.latency_p50_ms IS
  'Median per-item processing latency within this cycle (enrichment
   cycles only; NULL for collection cycles, which have no comparable
   per-item AI latency).';
COMMENT ON COLUMN public.pipeline_metrics.latency_p95_ms IS
  '95th-percentile per-item processing latency within this cycle.';
COMMENT ON COLUMN public.pipeline_metrics.queue_depth IS
  'Unprocessed observation count at the START of this cycle (before
   this cycle drained any of it).';
COMMENT ON COLUMN public.pipeline_metrics.oldest_pending_age_seconds IS
  'Age in seconds of the oldest still-unprocessed observation at the
   START of this cycle -- distinguishes a fresh backlog from a stuck
   one of the same size.';
