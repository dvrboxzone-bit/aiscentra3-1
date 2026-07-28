-- ============================================================
-- Migration: 20260728000007_create_signal_feedback
-- Signal Engine V2 — Feedback Loop architecture
-- Stores events for future self-improving intelligence
-- Phase 1: store only. No automatic application.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.signal_feedback (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ── Subject ───────────────────────────────────────────────────────────────
  signal_id       UUID REFERENCES public.signals(id),
  observation_id  UUID REFERENCES public.observations(id),

  -- ── Feedback source ───────────────────────────────────────────────────────
  feedback_type   TEXT NOT NULL,
  -- 'user'|'analyst'|'system'|'market'

  feedback_event  TEXT NOT NULL,
  -- 'viewed'|'shared'|'flagged_wrong'|'flagged_important'|
  -- 'cited'|'superseded'|'promoted'|'demoted'

  -- ── Feedback content ──────────────────────────────────────────────────────
  score_delta     NUMERIC(4,2),   -- how much to adjust signal score
  dimension       TEXT,
  -- which SIS dimension: 'novelty'|'importance'|'urgency'|'confidence'

  reason          TEXT,
  evidence        JSONB DEFAULT '{}',

  -- ── Self-improvement tracking ─────────────────────────────────────────────
  applied         BOOLEAN DEFAULT false,  -- has this feedback been applied?
  applied_at      TIMESTAMPTZ,

  -- ── Engine versioning ─────────────────────────────────────────────────────
  engine_version  TEXT DEFAULT 'v2.0',

  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fb_signal  ON public.signal_feedback(signal_id);
CREATE INDEX IF NOT EXISTS idx_fb_type    ON public.signal_feedback(feedback_type, feedback_event);
CREATE INDEX IF NOT EXISTS idx_fb_applied ON public.signal_feedback(applied) WHERE applied = false;

-- RLS — feedback is internal only
ALTER TABLE public.signal_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role only"
  ON public.signal_feedback FOR ALL
  TO service_role
  USING (true);

COMMENT ON TABLE public.signal_feedback IS
  'Feedback Loop architecture for Signal Engine V2.
   Phase 1: store events only. No automatic application.
   Phase 2: aggregate + suggest threshold changes.
   Phase 3: automatic weight adjustment with human oversight.';
