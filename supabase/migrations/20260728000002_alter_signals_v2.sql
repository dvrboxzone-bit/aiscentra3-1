-- ============================================================
-- Migration: 20260728000002_alter_signals_v2
-- Signal Engine V2 — New columns on signals table
-- All columns nullable — existing records unaffected
-- Weak Signals stored here via intelligence_type column
-- ============================================================

ALTER TABLE public.signals

  -- ── Intelligence classification ──────────────────────────────────────────
  -- 'OBSERVATION'|'WEAK_SIGNAL'|'SIGNAL'|'CRITICAL_SIGNAL'(reserved)
  ADD COLUMN IF NOT EXISTS intelligence_type TEXT NOT NULL DEFAULT 'SIGNAL',

  -- ── Strategic Importance Score — four independent dimensions ─────────────
  ADD COLUMN IF NOT EXISTS sis_novelty     NUMERIC(4,2),  -- 0–10
  ADD COLUMN IF NOT EXISTS sis_importance  NUMERIC(4,2),  -- 0–10
  ADD COLUMN IF NOT EXISTS sis_urgency     NUMERIC(4,2),  -- 0–10
  ADD COLUMN IF NOT EXISTS sis_confidence  NUMERIC(4,2),  -- 0–10
  ADD COLUMN IF NOT EXISTS sis_final       NUMERIC(4,2),  -- computed weighted sum

  -- ── Qualification ────────────────────────────────────────────────────────
  ADD COLUMN IF NOT EXISTS qualification_score   NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS qualification_detail  JSONB DEFAULT '{}',

  -- ── Future relevance ─────────────────────────────────────────────────────
  -- 'DAYS'|'WEEKS'|'MONTHS'|'YEARS'|'STRUCTURAL'
  ADD COLUMN IF NOT EXISTS relevance_horizon TEXT,
  ADD COLUMN IF NOT EXISTS relevance_detail  JSONB DEFAULT '{}',

  -- ── Reality check / Anti-hype ────────────────────────────────────────────
  ADD COLUMN IF NOT EXISTS anti_hype_score  NUMERIC(4,2),  -- 0–10, higher = more credible
  ADD COLUMN IF NOT EXISTS anti_hype_flags  JSONB DEFAULT '{}',

  -- ── Human relevance ──────────────────────────────────────────────────────
  ADD COLUMN IF NOT EXISTS human_relevance_flags JSONB DEFAULT '{}',
  -- {"cto": true, "vc": false, "founder": true, ...}

  -- ── Lifecycle ────────────────────────────────────────────────────────────
  ADD COLUMN IF NOT EXISTS lifecycle_state   TEXT DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS dormant_reason    TEXT,
  ADD COLUMN IF NOT EXISTS reactivate_after  TIMESTAMPTZ,

  -- ── Engine versioning ────────────────────────────────────────────────────
  ADD COLUMN IF NOT EXISTS engine_version TEXT DEFAULT 'v1.0';

-- Backfill existing signals as v1.0
UPDATE public.signals SET engine_version = 'v1.0' WHERE engine_version IS NULL;

COMMENT ON COLUMN public.signals.intelligence_type IS
  'Classification: OBSERVATION | WEAK_SIGNAL | SIGNAL | CRITICAL_SIGNAL';
COMMENT ON COLUMN public.signals.sis_final IS
  'SIS = (novelty×0.25) + (importance×0.35) + (urgency×0.20) + (confidence×0.20)';
COMMENT ON COLUMN public.signals.relevance_horizon IS
  'How long this signal remains relevant: DAYS | WEEKS | MONTHS | YEARS | STRUCTURAL';
