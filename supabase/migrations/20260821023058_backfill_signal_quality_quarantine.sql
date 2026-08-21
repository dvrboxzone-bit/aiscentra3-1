-- ============================================================
-- Quality-First Signal Foundation — deterministic legacy backfill
--
-- This migration never deletes Signals, never changes status/lifecycle,
-- and never creates an APPROVED row.
--
-- Rollback note: quality classifications can be returned to PENDING by
-- an explicit audited UPDATE. Original Signal data is never removed or
-- overwritten by this migration.
-- ============================================================

UPDATE public.signals
SET
  quality_state = CASE
    WHEN status IN ('WEAK', 'DORMANT', 'EXPIRED', 'REJECTED')
      THEN 'QUARANTINED'::public.signal_quality_state
    ELSE 'PENDING'::public.signal_quality_state
  END,
  quality_reason_codes = CASE status::TEXT
    WHEN 'WEAK' THEN ARRAY['LEGACY_STATUS_WEAK']::TEXT[]
    WHEN 'DORMANT' THEN ARRAY['LEGACY_STATUS_DORMANT']::TEXT[]
    WHEN 'EXPIRED' THEN ARRAY['LEGACY_STATUS_EXPIRED']::TEXT[]
    WHEN 'REJECTED' THEN ARRAY['LEGACY_STATUS_REJECTED']::TEXT[]
    WHEN 'ACTIVE' THEN ARRAY['AWAITING_QUALITY_REVIEW']::TEXT[]
    WHEN 'PROMOTED' THEN ARRAY['AWAITING_QUALITY_REVIEW']::TEXT[]
    ELSE ARRAY['AWAITING_QUALITY_REVIEW']::TEXT[]
  END,
  quality_rule_version = 'quality-foundation-v1',
  quality_evaluated_at = now(),
  quarantined_at = CASE
    WHEN status IN ('WEAK', 'DORMANT', 'EXPIRED', 'REJECTED') THEN now()
    ELSE NULL
  END;

-- State-change triggers already recorded PENDING -> QUARANTINED rows.
-- Add one initial snapshot for rows that remained PENDING, ensuring every
-- legacy Signal has an audit record without duplicating quarantine entries.
INSERT INTO public.signal_quality_decisions (
  signal_id,
  from_state,
  to_state,
  reason_codes,
  rule_version,
  evidence,
  decided_by
)
SELECT
  s.id,
  NULL,
  s.quality_state,
  s.quality_reason_codes,
  s.quality_rule_version,
  jsonb_build_object(
    'backfill', TRUE,
    'status', s.status,
    'intelligence_type', s.intelligence_type,
    'has_verified_source', s.has_verified_source,
    'verification_state', s.verification_state,
    'qualification_score', s.qualification_score,
    'sis_final', s.sis_final,
    'anti_hype_score', s.anti_hype_score,
    'validation_flags', s.validation_flags,
    'observation_count', cardinality(s.observation_ids)
  ),
  current_user
FROM public.signals s
WHERE NOT EXISTS (
  SELECT 1
  FROM public.signal_quality_decisions d
  WHERE d.signal_id = s.id
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.signals WHERE quality_state = 'APPROVED'
  ) THEN
    RAISE EXCEPTION 'quality foundation backfill must never create APPROVED Signals';
  END IF;
END
$$;
