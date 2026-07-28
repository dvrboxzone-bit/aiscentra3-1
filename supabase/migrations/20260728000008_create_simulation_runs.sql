-- ============================================================
-- Migration: 20260728000008_create_simulation_runs
-- Signal Engine V2 — Phase 0 dry-run infrastructure
-- Simulate V2 pipeline on historical observations before production
-- ============================================================

CREATE TABLE IF NOT EXISTS public.engine_simulation_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  run_type        TEXT DEFAULT 'dry_run',  -- 'dry_run'|'production'
  observation_ids UUID[],                  -- observations included in this run

  -- ── Per-observation results ───────────────────────────────────────────────
  results         JSONB,
  -- Array of per-observation objects:
  -- [{
  --   "observation_id": "...",
  --   "title": "...",
  --   "qualification_score": 7.2,
  --   "qualification_result": "SIGNAL",
  --   "sis_novelty": 6.0,
  --   "sis_importance": 7.5,
  --   "sis_urgency": 5.0,
  --   "sis_confidence": 6.5,
  --   "sis_final": 6.5,
  --   "human_relevance_count": 3,
  --   "rejection_code": null,
  --   "v1_was_signal": true,
  --   "v2_decision": "SIGNAL",
  --   "decision_changed": false
  -- }]

  -- ── Aggregate statistics ──────────────────────────────────────────────────
  summary         JSONB,
  -- {
  --   "total": 100,
  --   "signal": 12,
  --   "weak_signal": 23,
  --   "archive": 41,
  --   "discard": 24,
  --   "changed_from_v1": 35,
  --   "rejection_breakdown": {"R-01": 8, "R-04": 12, ...},
  --   "avg_sis_final": 4.2,
  --   "avg_qualification_score": 5.1
  -- }

  -- ── Engine versioning ─────────────────────────────────────────────────────
  engine_version  TEXT NOT NULL DEFAULT 'v2.0',

  -- ── Status ────────────────────────────────────────────────────────────────
  status          TEXT DEFAULT 'PENDING',  -- 'PENDING'|'RUNNING'|'COMPLETE'|'APPROVED'|'REJECTED'
  approved_by     TEXT,
  approved_at     TIMESTAMPTZ,
  notes           TEXT,

  created_at      TIMESTAMPTZ DEFAULT now(),
  completed_at    TIMESTAMPTZ
);

-- RLS — simulation runs are internal only
ALTER TABLE public.engine_simulation_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role only"
  ON public.engine_simulation_runs FOR ALL
  TO service_role
  USING (true);

COMMENT ON TABLE public.engine_simulation_runs IS
  'Phase 0 dry-run infrastructure for Signal Engine V2.
   Run V2 pipeline on last 100 observations without publishing.
   Review results before enabling V2 in production.
   status=APPROVED triggers production switch.';
