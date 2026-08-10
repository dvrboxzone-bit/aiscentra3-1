-- ============================================================
-- Migration: 20260809100000_atomic_signal_corroboration
--
-- Real bug this closes, found while implementing source
-- corroboration (PR #45): the corroboration path in engine.ts
-- performed THREE separate, unchecked `await` database writes --
-- update signals.observation_ids/confidence_score/momentum_score,
-- update the new observation's qualification_result, and write a
-- decision log entry -- none of which checked for an `error` in the
-- response. If any ONE of the three failed (e.g. the signals update
-- succeeds but the observations update fails on a transient network
-- blip), the function still proceeded to the next write and still
-- returned `outcome: 'corroborated_existing_signal'` with a decision
-- log claiming success -- a partially-applied corroboration with a
-- false audit trail, not fail-closed and not atomic.
--
-- Fixed by moving all three writes into ONE PL/pgSQL function. A
-- function body executes as a single transaction by default: if any
-- statement inside raises, the whole function rolls back and the
-- exception propagates to the caller -- there is no code path where
-- some writes commit and others do not.
-- ============================================================

CREATE OR REPLACE FUNCTION public.apply_signal_corroboration(
  p_signal_id             UUID,
  p_new_observation_id    UUID,
  p_updated_observation_ids UUID[],
  p_new_confidence_score  INT,
  p_new_momentum_score    INT,
  p_engine_version        TEXT,
  p_engine_justification  TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_signal_qual_score NUMERIC;
BEGIN
  UPDATE public.signals
  SET
    observation_ids = p_updated_observation_ids,
    confidence_score = p_new_confidence_score,
    momentum_score = p_new_momentum_score,
    momentum_last_calculated = now(),
    verification_state = public.compute_verification_state(array_length(p_updated_observation_ids, 1)),
    -- A corroborating observation may itself be the FIRST verified
    -- source this signal ever had -- re-evaluated on every merge
    -- inside the same transaction as everything else, so the
    -- publication gate can never lag behind the actual evidence.
    has_verified_source = public.compute_has_verified_source(p_updated_observation_ids)
  WHERE id = p_signal_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'apply_signal_corroboration: signal % not found', p_signal_id;
  END IF;

  -- REAL BUG FIXED: this previously set qualification_result='SIGNAL'
  -- with qualification_score=NULL -- exactly the "false SIGNAL with a
  -- NULL score" the task explicitly forbids. A corroborating
  -- observation never runs its own SIS (deliberately, to spend zero
  -- extra AI budget), so it has no independently-computed score of its
  -- own -- but leaving qualification_score NULL made it indistinguishable
  -- from the earlier, real bug (signals never including
  -- qualification_score at INSERT at all). Fixed by inheriting the
  -- MATCHED signal's own qualification_score (read below): this
  -- observation is now genuinely part of that signal's evidence base,
  -- and the signal's own score already reflects a real SIS assessment
  -- of the underlying event this observation corroborates.
  SELECT qualification_score INTO v_signal_qual_score
  FROM public.signals WHERE id = p_signal_id;

  UPDATE public.observations
  SET
    qualification_result = 'SIGNAL',
    qualification_score = v_signal_qual_score,
    engine_version = p_engine_version
  WHERE id = p_new_observation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'apply_signal_corroboration: observation % not found', p_new_observation_id;
  END IF;

  -- Decision log write happens inside the SAME transaction as the two
  -- updates above -- if this insert fails, the signal/observation
  -- updates above are rolled back too, so the audit trail can never
  -- disagree with what was actually applied. Real table name is
  -- signal_decision_log (confirmed via information_schema against
  -- production before writing this migration) -- NOT "decision_logs",
  -- which does not exist. id/decided_at/qualification_breakdown/
  -- human_relevance_breakdown/thresholds_snapshot/rule_trace all have
  -- database defaults and are intentionally omitted here.
  -- REAL BUG FIXED (same class as the observation UPDATE above):
  -- qualification_score was previously omitted from this INSERT
  -- entirely, so signal_decision_log disagreed with both
  -- signals.qualification_score and (after the fix above)
  -- observations.qualification_score for this exact event -- a
  -- three-way inconsistency for the same corroboration decision.
  INSERT INTO public.signal_decision_log (
    signal_id, observation_id, decision, engine_justification, engine_version, qualification_score
  )
  VALUES (
    p_signal_id, p_new_observation_id, 'SIGNAL', p_engine_justification, p_engine_version, v_signal_qual_score
  );

  RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION public.apply_signal_corroboration IS
  'Atomically applies a source-corroboration match: updates the
   existing signal''s observation_ids/confidence_score/momentum_score,
   marks the new observation as qualified, and writes the
   signal_decision_log entry -- all in one transaction. Raises (rolling
   back all three) if the target signal or observation does not exist,
   so a caller that catches the exception can be certain nothing was
   partially applied.';

-- Same lockdown posture as 20260809040000's hardening migration for
-- the token-budget/execution-lock functions: service_role only.
REVOKE EXECUTE ON FUNCTION public.apply_signal_corroboration(UUID, UUID, UUID[], INT, INT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_signal_corroboration(UUID, UUID, UUID[], INT, INT, TEXT, TEXT)
  TO service_role;
ALTER FUNCTION public.apply_signal_corroboration(UUID, UUID, UUID[], INT, INT, TEXT, TEXT)
  SET search_path = pg_catalog;
