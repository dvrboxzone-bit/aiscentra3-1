-- ============================================================
-- Quality-First Signal Foundation — additive schema only
--
-- Safety contract for this phase:
--   * existing public Signal RLS is intentionally unchanged;
--   * every Signal defaults to PENDING, never APPROVED;
--   * approval is impossible unless all strict V2 invariants hold;
--   * every quality-state transition is recorded append-only;
--   * no Signal lifecycle/status value is changed here.
--
-- Rollback (manual, only before consumers depend on this schema):
-- drop the quality triggers/functions/table/indexes/constraints/columns,
-- then drop public.signal_quality_state. No Signal rows are deleted.
-- ============================================================

DO $$
BEGIN
  CREATE TYPE public.signal_quality_state AS ENUM (
    'PENDING',
    'APPROVED',
    'QUARANTINED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

ALTER TABLE public.signals
  ADD COLUMN IF NOT EXISTS quality_state public.signal_quality_state
    NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS quality_reason_codes TEXT[]
    NOT NULL DEFAULT ARRAY['AWAITING_QUALITY_REVIEW']::TEXT[],
  ADD COLUMN IF NOT EXISTS quality_rule_version TEXT
    NOT NULL DEFAULT 'quality-foundation-v1',
  ADD COLUMN IF NOT EXISTS quality_evaluated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS quarantined_at TIMESTAMPTZ;

ALTER TABLE public.signals
  DROP CONSTRAINT IF EXISTS signals_quality_state_metadata_check;

ALTER TABLE public.signals
  ADD CONSTRAINT signals_quality_state_metadata_check CHECK (
    (
      quality_state = 'APPROVED'
      AND cardinality(quality_reason_codes) = 0
      AND quality_evaluated_at IS NOT NULL
      AND quarantined_at IS NULL
    )
    OR (
      quality_state = 'PENDING'
      AND cardinality(quality_reason_codes) > 0
      AND quarantined_at IS NULL
    )
    OR (
      quality_state = 'QUARANTINED'
      AND cardinality(quality_reason_codes) > 0
      AND quality_evaluated_at IS NOT NULL
      AND quarantined_at IS NOT NULL
    )
  );

ALTER TABLE public.signals
  DROP CONSTRAINT IF EXISTS signals_quality_approved_v2_invariants_check;

-- This constraint is intentionally strict even though no current Signal
-- passes it. It protects the FUTURE APPROVED state without changing which
-- rows the current public feed can read in this phase.
ALTER TABLE public.signals
  ADD CONSTRAINT signals_quality_approved_v2_invariants_check CHECK (
    quality_state <> 'APPROVED'
    OR (
      status IN ('ACTIVE', 'PROMOTED')
      AND intelligence_type IN ('SIGNAL', 'CRITICAL_SIGNAL')
      AND has_verified_source = TRUE
      AND verification_state IN ('CORROBORATED', 'VERIFIED')
      AND qualification_score >= 6.0
      AND sis_final >= 6.0
      AND anti_hype_score >= 3.0
      AND cardinality(validation_flags) = 0
      AND cardinality(observation_ids) >= 2
      AND quality_rule_version <> ''
    )
  );

CREATE INDEX IF NOT EXISTS idx_signals_quality_state
  ON public.signals (quality_state);

CREATE INDEX IF NOT EXISTS idx_signals_quality_pending_review
  ON public.signals (created_at DESC)
  WHERE quality_state = 'PENDING';

CREATE INDEX IF NOT EXISTS idx_signals_quality_quarantine
  ON public.signals (quarantined_at DESC)
  WHERE quality_state = 'QUARANTINED';

COMMENT ON COLUMN public.signals.quality_state IS
  'Independent publication-quality review state. PENDING is the fail-safe default; APPROVED requires strict V2 invariants; QUARANTINED preserves weak or rejected material without deletion.';
COMMENT ON COLUMN public.signals.quality_reason_codes IS
  'Machine-readable quality decision reasons. APPROVED must have an empty array; PENDING and QUARANTINED require at least one reason.';
COMMENT ON COLUMN public.signals.quality_rule_version IS
  'Version of the deterministic quality rules used for the latest evaluation.';
COMMENT ON COLUMN public.signals.quality_evaluated_at IS
  'Time of the latest completed quality evaluation. NULL means never evaluated.';
COMMENT ON COLUMN public.signals.quarantined_at IS
  'Time the Signal entered QUARANTINED. Quarantine preserves the row and its lifecycle/status.';

CREATE TABLE IF NOT EXISTS public.signal_quality_decisions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  signal_id UUID NOT NULL REFERENCES public.signals(id) ON DELETE RESTRICT,
  from_state public.signal_quality_state,
  to_state public.signal_quality_state NOT NULL,
  reason_codes TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  rule_version TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '{}'::JSONB,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by TEXT NOT NULL DEFAULT current_user
);

CREATE INDEX IF NOT EXISTS idx_signal_quality_decisions_signal_time
  ON public.signal_quality_decisions (signal_id, decided_at DESC);

ALTER TABLE public.signal_quality_decisions ENABLE ROW LEVEL SECURITY;

-- The quality ledger is internal. Existing-project default privileges can
-- expose new public-schema tables automatically, so revoke explicitly.
REVOKE ALL ON TABLE public.signal_quality_decisions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.signal_quality_decisions_id_seq FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.signal_quality_decisions TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.signal_quality_decisions_id_seq TO service_role;

COMMENT ON TABLE public.signal_quality_decisions IS
  'Append-only audit ledger for every Signal quality-state transition. Internal service-role access only; no public RLS policies.';

CREATE OR REPLACE FUNCTION public.prevent_signal_quality_decision_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'signal_quality_decisions is append-only: % is forbidden', TG_OP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.prevent_signal_quality_decision_mutation()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS signal_quality_decisions_no_update_delete
  ON public.signal_quality_decisions;
CREATE TRIGGER signal_quality_decisions_no_update_delete
  BEFORE UPDATE OR DELETE ON public.signal_quality_decisions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_signal_quality_decision_mutation();

DROP TRIGGER IF EXISTS signal_quality_decisions_no_truncate
  ON public.signal_quality_decisions;
CREATE TRIGGER signal_quality_decisions_no_truncate
  BEFORE TRUNCATE ON public.signal_quality_decisions
  FOR EACH STATEMENT EXECUTE FUNCTION public.prevent_signal_quality_decision_mutation();

CREATE OR REPLACE FUNCTION public.record_signal_quality_decision()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public.signal_quality_decisions (
    signal_id,
    from_state,
    to_state,
    reason_codes,
    rule_version,
    evidence,
    decided_by
  ) VALUES (
    NEW.id,
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.quality_state ELSE NULL END,
    NEW.quality_state,
    NEW.quality_reason_codes,
    NEW.quality_rule_version,
    jsonb_build_object(
      'status', NEW.status,
      'intelligence_type', NEW.intelligence_type,
      'has_verified_source', NEW.has_verified_source,
      'verification_state', NEW.verification_state,
      'qualification_score', NEW.qualification_score,
      'sis_final', NEW.sis_final,
      'anti_hype_score', NEW.anti_hype_score,
      'validation_flags', NEW.validation_flags,
      'observation_count', cardinality(NEW.observation_ids)
    ),
    current_user
  );
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_signal_quality_decision()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_signal_quality_decision() TO service_role;

DROP TRIGGER IF EXISTS signals_quality_decision_on_insert ON public.signals;
CREATE TRIGGER signals_quality_decision_on_insert
  AFTER INSERT ON public.signals
  FOR EACH ROW EXECUTE FUNCTION public.record_signal_quality_decision();

DROP TRIGGER IF EXISTS signals_quality_decision_on_state_change ON public.signals;
CREATE TRIGGER signals_quality_decision_on_state_change
  AFTER UPDATE OF quality_state ON public.signals
  FOR EACH ROW
  WHEN (OLD.quality_state IS DISTINCT FROM NEW.quality_state)
  EXECUTE FUNCTION public.record_signal_quality_decision();

-- New Events contain public Forecast text under the current unchanged RLS.
-- Block their creation at the database boundary unless the origin Signal has
-- already completed explicit quality approval.
CREATE OR REPLACE FUNCTION public.enforce_quality_approved_event_origin()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.signals s
    WHERE s.id = NEW.signal_id
      AND s.quality_state = 'APPROVED'
  ) THEN
    RAISE EXCEPTION 'Event/Forecast creation requires an APPROVED origin Signal';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_quality_approved_event_origin()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_quality_approved_event_origin() TO service_role;

DROP TRIGGER IF EXISTS events_require_quality_approved_signal_on_insert ON public.events;
CREATE TRIGGER events_require_quality_approved_signal_on_insert
  BEFORE INSERT ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.enforce_quality_approved_event_origin();

DROP TRIGGER IF EXISTS events_require_quality_approved_signal_on_update ON public.events;
CREATE TRIGGER events_require_quality_approved_signal_on_update
  BEFORE UPDATE OF signal_id ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.enforce_quality_approved_event_origin();

-- Reports may always be stored as internal drafts (published_at IS NULL).
-- Publication is blocked unless every referenced Signal and Event origin is
-- quality-approved. Missing/dangling evidence fails closed.
CREATE OR REPLACE FUNCTION public.enforce_quality_approved_report_publication()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.published_at IS NULL THEN
    RETURN NEW;
  END IF;

  IF cardinality(NEW.signal_ids) = 0 THEN
    RAISE EXCEPTION 'Report publication requires at least one APPROVED Signal';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(NEW.signal_ids) AS required_signal_id
    LEFT JOIN public.signals s ON s.id = required_signal_id
    WHERE s.id IS NULL OR s.quality_state <> 'APPROVED'
  ) THEN
    RAISE EXCEPTION 'Report publication references a missing or non-APPROVED Signal';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(NEW.event_ids) AS required_event_id
    LEFT JOIN public.events e ON e.id = required_event_id
    LEFT JOIN public.signals s ON s.id = e.signal_id
    WHERE e.id IS NULL OR s.id IS NULL OR s.quality_state <> 'APPROVED'
  ) THEN
    RAISE EXCEPTION 'Report publication references an Event without an APPROVED origin Signal';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_quality_approved_report_publication()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_quality_approved_report_publication() TO service_role;

DROP TRIGGER IF EXISTS reports_require_quality_approved_evidence_on_insert ON public.reports;
CREATE TRIGGER reports_require_quality_approved_evidence_on_insert
  BEFORE INSERT ON public.reports
  FOR EACH ROW EXECUTE FUNCTION public.enforce_quality_approved_report_publication();

DROP TRIGGER IF EXISTS reports_require_quality_approved_evidence_on_update ON public.reports;
CREATE TRIGGER reports_require_quality_approved_evidence_on_update
  BEFORE UPDATE OF published_at, signal_ids, event_ids ON public.reports
  FOR EACH ROW EXECUTE FUNCTION public.enforce_quality_approved_report_publication();
