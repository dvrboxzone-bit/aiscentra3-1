-- DRAFT-only, human-invoked corroboration/quality approval.
-- No endpoint, scheduler, provider call, or automatic promotion is introduced.

ALTER TABLE public.sources
  ADD COLUMN IF NOT EXISTS provenance_root TEXT;

ALTER TABLE public.sources
  DROP CONSTRAINT IF EXISTS sources_provenance_root_canonical_check;
ALTER TABLE public.sources
  ADD CONSTRAINT sources_provenance_root_canonical_check CHECK (
    provenance_root IS NULL
    OR provenance_root ~ '^[a-z0-9][a-z0-9.-]*[a-z0-9]$'
  );

-- Conservative, deterministic backfill for the exact registered publisher
-- families. Unknown ownership remains NULL and therefore never counts as an
-- independent root.
UPDATE public.sources
SET provenance_root = CASE
  WHEN lower(url) ~ '^https://(www\.)?anthropic\.com(/|$)' THEN 'anthropic.com'
  WHEN lower(url) ~ '^https://(www\.)?arxiv\.org(/|$)' THEN 'arxiv.org'
  WHEN lower(url) ~ '^https://(www\.)?github\.blog(/|$)' THEN 'github.com'
  WHEN lower(url) ~ '^https://(www\.)?deepmind\.google(/|$)' THEN 'google'
  WHEN lower(url) ~ '^https://(www\.)?huggingface\.co(/|$)' THEN 'huggingface.co'
  WHEN lower(url) ~ '^https://(www\.)?ai\.meta\.com(/|$)' THEN 'meta.com'
  WHEN lower(url) ~ '^https://(www\.)?mistral\.ai(/|$)' THEN 'mistral.ai'
  WHEN lower(url) ~ '^https://(www\.)?openai\.com(/|$)' THEN 'openai.com'
  ELSE NULL
END
WHERE provenance_root IS NULL;

COMMENT ON COLUMN public.sources.provenance_root IS
  'Canonical publisher/ownership root used for provenance independence. NULL is unknown and never counts as independent corroboration.';

CREATE TABLE public.signal_corroboration_audits (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  signal_id UUID NOT NULL REFERENCES public.signals(id) ON DELETE RESTRICT,
  observation_id UUID NOT NULL REFERENCES public.observations(id) ON DELETE RESTRICT,
  evidence_observation_ids UUID[] NOT NULL,
  evidence_provenance_roots TEXT[] NOT NULL,
  rule_version TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT current_user,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (signal_id, observation_id)
);

ALTER TABLE public.signal_corroboration_audits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.signal_corroboration_audits FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.signal_corroboration_audits_id_seq FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.signal_corroboration_audits TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.signal_corroboration_audits_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.prevent_signal_corroboration_audit_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'signal_corroboration_audits is append-only: % is forbidden', TG_OP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.prevent_signal_corroboration_audit_mutation()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER signal_corroboration_audits_no_update_delete
  BEFORE UPDATE OR DELETE ON public.signal_corroboration_audits
  FOR EACH ROW EXECUTE FUNCTION public.prevent_signal_corroboration_audit_mutation();
CREATE TRIGGER signal_corroboration_audits_no_truncate
  BEFORE TRUNCATE ON public.signal_corroboration_audits
  FOR EACH STATEMENT EXECUTE FUNCTION public.prevent_signal_corroboration_audit_mutation();

-- The single canonical predicate used by both the CHECK constraint and the
-- protected transition operation.
CREATE OR REPLACE FUNCTION public.signal_meets_quality_approval_predicates(p_signal public.signals)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
  SELECT (
    p_signal.status IN ('ACTIVE', 'PROMOTED')
    AND p_signal.intelligence_type IN ('SIGNAL', 'CRITICAL_SIGNAL')
    AND p_signal.has_verified_source = TRUE
    AND p_signal.verification_state IN ('CORROBORATED', 'VERIFIED')
    AND p_signal.qualification_score >= 6.0
    AND p_signal.sis_final >= 6.0
    AND p_signal.anti_hype_score >= 3.0
    AND cardinality(p_signal.validation_flags) = 0
    AND cardinality(p_signal.observation_ids) >= 2
    AND p_signal.quality_rule_version <> ''
  ) IS TRUE;
$$;

REVOKE EXECUTE ON FUNCTION public.signal_meets_quality_approval_predicates(public.signals)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.signal_meets_quality_approval_predicates(public.signals)
  TO service_role;

ALTER TABLE public.signals
  DROP CONSTRAINT signals_quality_approved_v2_invariants_check;
ALTER TABLE public.signals
  ADD CONSTRAINT signals_quality_approved_v2_invariants_check CHECK (
    quality_state <> 'APPROVED'
    OR public.signal_meets_quality_approval_predicates(signals)
  );

-- Preserve the append-only quality ledger while enriching its evidence with
-- the exact observation IDs and canonical provenance roots used by approval.
CREATE OR REPLACE FUNCTION public.record_signal_quality_decision()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_roots TEXT[];
BEGIN
  SELECT COALESCE(array_agg(DISTINCT src.provenance_root ORDER BY src.provenance_root), '{}'::TEXT[])
  INTO v_roots
  FROM public.observations obs
  JOIN public.sources src ON src.id = obs.source_id
  WHERE obs.id = ANY(NEW.observation_ids)
    AND src.provenance_root IS NOT NULL;

  INSERT INTO public.signal_quality_decisions (
    signal_id, from_state, to_state, reason_codes, rule_version, evidence, decided_by
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
      'observation_ids', NEW.observation_ids,
      'provenance_roots', v_roots
    ),
    current_user
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.corroborate_draft_signal(
  p_signal_id UUID,
  p_observation_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_signal public.signals%ROWTYPE;
  v_observation public.observations%ROWTYPE;
  v_observation_ids UUID[];
  v_roots TEXT[];
BEGIN
  SELECT * INTO v_signal
  FROM public.signals
  WHERE id = p_signal_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'corroborate_draft_signal: signal not found';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.signal_corroboration_audits
    WHERE signal_id = p_signal_id AND observation_id = p_observation_id
  ) THEN
    RETURN jsonb_build_object('applied', false, 'duplicate', true);
  END IF;

  IF v_signal.status <> 'DRAFT'
    OR v_signal.quality_state <> 'PENDING'
    OR v_signal.intelligence_type <> 'SIGNAL' THEN
    RAISE EXCEPTION 'corroborate_draft_signal: only DRAFT/PENDING SIGNAL is eligible';
  END IF;

  SELECT obs.* INTO v_observation
  FROM public.observations obs
  JOIN public.sources src ON src.id = obs.source_id
  WHERE obs.id = p_observation_id
    AND obs.processed = false
    AND obs.signal_id IS NULL
    AND obs.url_verified_ok = true
    AND src.status = 'ACTIVE'
    AND src.provenance_root IS NOT NULL
  FOR UPDATE OF obs;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'corroborate_draft_signal: observation is not eligible';
  END IF;

  IF p_observation_id = ANY(v_signal.observation_ids) THEN
    RAISE EXCEPTION 'corroborate_draft_signal: inconsistent existing link without audit';
  END IF;

  v_observation_ids := array_append(v_signal.observation_ids, p_observation_id);

  SELECT array_agg(DISTINCT src.provenance_root ORDER BY src.provenance_root)
  INTO v_roots
  FROM public.observations obs
  JOIN public.sources src ON src.id = obs.source_id
  WHERE obs.id = ANY(v_observation_ids)
    AND src.provenance_root IS NOT NULL;

  IF COALESCE(cardinality(v_roots), 0) < 2 THEN
    RAISE EXCEPTION 'corroborate_draft_signal: two distinct known provenance roots are required';
  END IF;

  v_signal.observation_ids := v_observation_ids;
  v_signal.verification_state := CASE
    WHEN cardinality(v_roots) >= 3 THEN 'VERIFIED'
    ELSE 'CORROBORATED'
  END;
  v_signal.has_verified_source := public.compute_has_verified_source(v_observation_ids);
  v_signal.status := 'ACTIVE';
  v_signal.quality_state := 'APPROVED';
  v_signal.quality_reason_codes := '{}'::TEXT[];
  v_signal.quality_rule_version := 'draft-corroboration-approval-v1';
  v_signal.quality_evaluated_at := now();
  v_signal.quarantined_at := NULL;

  IF NOT public.signal_meets_quality_approval_predicates(v_signal) THEN
    RAISE EXCEPTION 'corroborate_draft_signal: quality predicates are not satisfied';
  END IF;

  UPDATE public.signals
  SET observation_ids = v_signal.observation_ids,
      verification_state = v_signal.verification_state,
      has_verified_source = v_signal.has_verified_source,
      status = v_signal.status,
      quality_state = v_signal.quality_state,
      quality_reason_codes = v_signal.quality_reason_codes,
      quality_rule_version = v_signal.quality_rule_version,
      quality_evaluated_at = v_signal.quality_evaluated_at,
      quarantined_at = v_signal.quarantined_at
  WHERE id = p_signal_id;

  UPDATE public.observations
  SET signal_id = p_signal_id,
      processed = true
  WHERE id = p_observation_id;

  INSERT INTO public.signal_corroboration_audits (
    signal_id, observation_id, evidence_observation_ids,
    evidence_provenance_roots, rule_version
  ) VALUES (
    p_signal_id, p_observation_id, v_observation_ids,
    v_roots, 'draft-corroboration-approval-v1'
  );

  RETURN jsonb_build_object(
    'applied', true,
    'duplicate', false,
    'status', 'ACTIVE',
    'quality_state', 'APPROVED',
    'verification_state', v_signal.verification_state
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.corroborate_draft_signal(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.corroborate_draft_signal(UUID, UUID)
  TO service_role;

COMMENT ON FUNCTION public.corroborate_draft_signal(UUID, UUID) IS
  'Service-role-only, explicit DRAFT approval operation. Atomically links one existing eligible observation, requires two known independent provenance roots, appends audit records, and transitions to APPROVED/ACTIVE. No provider or automatic invocation.';
