-- ============================================================
-- Migration: 20260810010000_add_signal_verification_state
--
-- Real gap this closes: this project's ONLY signal of "how many
-- independent sources back this claim" was the raw length of
-- observation_ids -- there was no explicit, named state a reader (or
-- the Assistant/forecast systems) could check to distinguish "this
-- signal rests on one company's own blog post" from "this signal has
-- been independently corroborated by an unrelated outlet."
-- confidence_score (AI's own certainty in its interpretation),
-- qualification_result (SIS/pre-filter classification), and status
-- (lifecycle: ACTIVE/WEAK/PROMOTED/ARCHIVED) each answer a DIFFERENT
-- question -- none of them answer "has this been independently
-- confirmed." Conflating verification into any of those three would
-- make each harder to reason about on its own; kept as its own column
-- for exactly that reason.
-- ============================================================

ALTER TABLE public.signals
  ADD COLUMN IF NOT EXISTS verification_state TEXT NOT NULL DEFAULT 'SINGLE_SOURCE_UNVERIFIED';

ALTER TABLE public.signals
  DROP CONSTRAINT IF EXISTS signals_verification_state_check;

ALTER TABLE public.signals
  ADD CONSTRAINT signals_verification_state_check
  CHECK (verification_state IN ('SINGLE_SOURCE_UNVERIFIED', 'CORROBORATED', 'VERIFIED', 'DISPUTED'));

CREATE INDEX IF NOT EXISTS idx_signals_verification_state
  ON public.signals (verification_state);

COMMENT ON COLUMN public.signals.verification_state IS
  'Independent-source confirmation state, DISTINCT from confidence_score
   (AI interpretation certainty), qualification_result (SIS/pre-filter
   classification), and status (lifecycle: ACTIVE/WEAK/PROMOTED/
   ARCHIVED).

   SINGLE_SOURCE_UNVERIFIED (default): rests on exactly one
     observation/source. This was the state of every signal in
     production before source corroboration existed.
   CORROBORATED: exactly 2 independent sources (one corroboration
     event applied via apply_signal_corroboration).
   VERIFIED: 3 or more independent sources -- a materially stronger
     evidentiary bar than a single corroboration, deliberately set
     higher than CORROBORATED rather than treating any second source
     as full "verification."
   DISPUTED: reserved for a future contradiction-detection mechanism
     (comparing independently-sourced claims for disagreement, not
     just topical similarity) -- schema and CHECK constraint support
     this value now, but nothing in this migration or the current
     application code sets it automatically. Detecting genuine
     contradiction reliably needs semantic comparison this project
     does not yet perform without spending additional AI budget, which
     conflicts with the deterministic, AI-cost-conscious design of the
     rest of this pass. Available for a manual/admin override or a
     dedicated future mechanism.';

-- Real function used by apply_signal_corroboration (see the updated
-- 20260809100000 logic invoked from engine.ts) to compute the new
-- verification_state from the resulting observation count, so the
-- threshold logic lives in exactly one place rather than being
-- duplicated between SQL and TypeScript.
CREATE OR REPLACE FUNCTION public.compute_verification_state(p_observation_count INT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_observation_count >= 3 THEN
    RETURN 'VERIFIED';
  ELSIF p_observation_count = 2 THEN
    RETURN 'CORROBORATED';
  ELSE
    RETURN 'SINGLE_SOURCE_UNVERIFIED';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.compute_verification_state(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compute_verification_state(INT) TO service_role;
ALTER FUNCTION public.compute_verification_state(INT) SET search_path = pg_catalog;
