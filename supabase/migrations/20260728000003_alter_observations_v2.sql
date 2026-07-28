-- ============================================================
-- Migration: 20260728000003_alter_observations_v2
-- Signal Engine V2 — Qualification tracking on observations
-- ============================================================

ALTER TABLE public.observations

  -- ── Qualification result ──────────────────────────────────────────────────
  -- 'DISCARD'|'ARCHIVE'|'WEAK_SIGNAL'|'SIGNAL'
  ADD COLUMN IF NOT EXISTS qualification_result TEXT,

  -- ── Rejection tracking ────────────────────────────────────────────────────
  -- Codes: R-01 through R-12 (see Signal Engine V2 spec)
  ADD COLUMN IF NOT EXISTS rejection_code   TEXT,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS rejection_detail JSONB DEFAULT '{}',

  -- ── Qualification score ───────────────────────────────────────────────────
  ADD COLUMN IF NOT EXISTS qualification_score NUMERIC(5,2),

  -- ── Dry run simulation output ─────────────────────────────────────────────
  ADD COLUMN IF NOT EXISTS dry_run_result JSONB DEFAULT '{}',

  -- ── Engine versioning ────────────────────────────────────────────────────
  ADD COLUMN IF NOT EXISTS engine_version TEXT DEFAULT 'v1.0';

-- Backfill existing observations
UPDATE public.observations SET engine_version = 'v1.0' WHERE engine_version IS NULL;

COMMENT ON COLUMN public.observations.rejection_code IS
  'R-01=NO_DECISION_IMPACT R-02=BENCHMARK_ONLY R-03=INCREMENTAL R-04=SINGLE_DOMAIN
   R-05=PROMOTIONAL R-06=DERIVATIVE R-07=NO_VALIDATION R-08=TEMPORAL
   R-09=ZERO_HUMAN_RELEVANCE R-10=LOW_CONFIDENCE R-11=DUPLICATE R-12=CATEGORY_REJECT';
