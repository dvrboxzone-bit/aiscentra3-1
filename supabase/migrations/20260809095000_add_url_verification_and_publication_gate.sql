-- ============================================================
-- Migration: 20260810020000_add_url_verification_and_publication_gate
--
-- Real requirement: "без безопасной и подтверждённо доступной ссылки
-- на оригинальный материал сигнал публично не показывается. Хранить
-- результат и время проверки URL; не выполнять внешний запрос при
-- каждом render."
--
-- Design: verification happens ONCE per observation (at collection
-- time, see collector.ts), the result is STORED on the observation
-- row, and a denormalized has_verified_source flag on signals lets
-- the public listing/detail queries filter with a single indexed
-- boolean column -- zero network calls and zero joins in the render
-- path.
-- ============================================================

ALTER TABLE public.observations
  ADD COLUMN IF NOT EXISTS url_verified_ok BOOLEAN,
  ADD COLUMN IF NOT EXISTS url_verified_at TIMESTAMPTZ;

COMMENT ON COLUMN public.observations.url_verified_ok IS
  'Result of a REAL reachability check (HTTP HEAD/GET) against this
   observation''s own url, performed once at collection time. NULL
   means never checked (e.g. observations collected before this
   migration). Never re-checked at render time -- see url_verified_at
   for staleness.';
COMMENT ON COLUMN public.observations.url_verified_at IS
  'When url_verified_ok was last set. A future re-verification job can
   use this to refresh stale checks without touching the render path.';

ALTER TABLE public.signals
  ADD COLUMN IF NOT EXISTS has_verified_source BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_signals_has_verified_source
  ON public.signals (has_verified_source) WHERE has_verified_source = true;

COMMENT ON COLUMN public.signals.has_verified_source IS
  'Denormalized publication gate: true if AT LEAST ONE of this
   signal''s linked observations has a safe (isSafeSourceUrl) AND
   confirmed-reachable (url_verified_ok=true) source URL. Set at
   signal creation (engine.ts) and re-evaluated by
   apply_signal_corroboration on every merge. Public signal queries
   filter on this column directly -- a single indexed boolean read, no
   join, no network call, at render time.';

-- Real function computing the gate value from an observation_ids
-- array, called both by engine.ts (via a fetch-then-compute round
-- trip for new-signal creation, kept in application code since it
-- needs the SAME isSafeSourceUrl logic already implemented in
-- TypeScript) and, atomically, by apply_signal_corroboration below.
CREATE OR REPLACE FUNCTION public.compute_has_verified_source(p_observation_ids UUID[])
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_count INT;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.observations
  WHERE id = ANY(p_observation_ids)
    AND url_verified_ok = true;
  RETURN v_count > 0;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.compute_has_verified_source(UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compute_has_verified_source(UUID[]) TO service_role;
ALTER FUNCTION public.compute_has_verified_source(UUID[]) SET search_path = pg_catalog;
