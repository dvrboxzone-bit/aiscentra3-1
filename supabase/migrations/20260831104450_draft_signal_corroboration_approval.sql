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
  'Canonical source/publisher root used as a secondary provenance guard. NULL is unknown and never counts as independent corroboration.';

-- Observation-level ownership is explicit and append-only. Source hostnames,
-- titles, and similarity are deliberately not used to infer origin ownership.
CREATE TABLE public.observation_provenance_assessments (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  observation_id UUID NOT NULL REFERENCES public.observations(id) ON DELETE RESTRICT,
  origin_owner TEXT,
  independence_status TEXT NOT NULL CHECK (
    independence_status IN (
      'UNKNOWN', 'ORIGIN_CONFIRMED', 'SAME_ORIGIN', 'INDEPENDENTLY_VERIFIED'
    )
  ),
  assessment_basis TEXT NOT NULL CHECK (btrim(assessment_basis) <> ''),
  rule_version TEXT NOT NULL CHECK (btrim(rule_version) <> ''),
  actor TEXT NOT NULL DEFAULT current_user,
  assessed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (
      independence_status = 'UNKNOWN'
      AND origin_owner IS NULL
    )
    OR (
      independence_status <> 'UNKNOWN'
      AND origin_owner IS NOT NULL
      AND origin_owner ~ '^[a-z0-9][a-z0-9._:-]*$'
    )
  )
);

CREATE INDEX observation_provenance_assessments_latest_idx
  ON public.observation_provenance_assessments (observation_id, assessed_at DESC, id DESC);

ALTER TABLE public.observation_provenance_assessments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.observation_provenance_assessments
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.observation_provenance_assessments_id_seq
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.observation_provenance_assessments TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.observation_provenance_assessments_id_seq
  TO service_role;

CREATE OR REPLACE FUNCTION public.prevent_observation_provenance_assessment_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'observation_provenance_assessments is append-only: % is forbidden', TG_OP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.prevent_observation_provenance_assessment_mutation()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER observation_provenance_assessments_no_update_delete
  BEFORE UPDATE OR DELETE ON public.observation_provenance_assessments
  FOR EACH ROW EXECUTE FUNCTION public.prevent_observation_provenance_assessment_mutation();
CREATE TRIGGER observation_provenance_assessments_no_truncate
  BEFORE TRUNCATE ON public.observation_provenance_assessments
  FOR EACH STATEMENT EXECUTE FUNCTION public.prevent_observation_provenance_assessment_mutation();

CREATE TABLE public.signal_corroboration_audits (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  signal_id UUID NOT NULL REFERENCES public.signals(id) ON DELETE RESTRICT,
  observation_id UUID NOT NULL REFERENCES public.observations(id) ON DELETE RESTRICT,
  evidence_observation_ids UUID[] NOT NULL,
  evidence_provenance_roots TEXT[] NOT NULL,
  provenance_assessments JSONB NOT NULL,
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

-- Evidence tier is deliberately separate from verification_state. A bounded
-- issuer statement or self-reported preprint can be PRIMARY_CONFIRMED while it
-- remains SINGLE_SOURCE_UNVERIFIED; it is never relabelled as independent
-- corroboration.
ALTER TABLE public.signals
  ADD COLUMN IF NOT EXISTS evidence_tier TEXT NOT NULL DEFAULT 'UNASSESSED';
ALTER TABLE public.signals
  DROP CONSTRAINT IF EXISTS signals_evidence_tier_check;
ALTER TABLE public.signals
  ADD CONSTRAINT signals_evidence_tier_check CHECK (
    evidence_tier IN ('UNASSESSED', 'PRIMARY_CONFIRMED', 'CORROBORATED', 'VERIFIED')
  );

COMMENT ON COLUMN public.signals.evidence_tier IS
  'Versioned evidence classification, separate from verification_state. PRIMARY_CONFIRMED is attributed issuer/preprint evidence, not independent verification.';

-- Immutable source-policy register. Exact source IDs and their registered URLs
-- are the contract: hostname, title, trust score, marketing copy, and model
-- output are never sufficient to grant PRIMARY_CONFIRMED.
CREATE TABLE public.primary_source_policy_rules (
  policy_version TEXT NOT NULL,
  source_id UUID NOT NULL REFERENCES public.sources(id) ON DELETE RESTRICT,
  registered_source_url TEXT NOT NULL,
  source_class TEXT NOT NULL CHECK (
    source_class IN ('OFFICIAL_ISSUER', 'SCHOLARLY_PRIMARY', 'EXCLUDE')
  ),
  policy_action TEXT NOT NULL CHECK (policy_action IN ('ALLOW', 'EXCLUDE')),
  origin_owner_strategy TEXT NOT NULL CHECK (
    origin_owner_strategy IN ('FIXED_ISSUER', 'ARXIV_ARTIFACT', 'NONE')
  ),
  fixed_origin_owner TEXT,
  provenance_root TEXT NOT NULL,
  allowed_claim_scope TEXT NOT NULL CHECK (btrim(allowed_claim_scope) <> ''),
  prohibited_claims TEXT[] NOT NULL,
  required_attribution TEXT,
  actor TEXT NOT NULL DEFAULT current_user,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (policy_version, source_id),
  CHECK (
    (policy_action = 'ALLOW' AND required_attribution IS NOT NULL)
    OR (policy_action = 'EXCLUDE' AND required_attribution IS NULL)
  ),
  CHECK (
    (origin_owner_strategy = 'FIXED_ISSUER' AND fixed_origin_owner IS NOT NULL)
    OR (origin_owner_strategy <> 'FIXED_ISSUER' AND fixed_origin_owner IS NULL)
  )
);

ALTER TABLE public.primary_source_policy_rules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.primary_source_policy_rules FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.primary_source_policy_rules TO service_role;

INSERT INTO public.primary_source_policy_rules (
  policy_version, source_id, registered_source_url, source_class,
  policy_action, origin_owner_strategy, fixed_origin_owner, provenance_root,
  allowed_claim_scope, prohibited_claims, required_attribution, actor
) VALUES
  (
    'primary-confirmed-v1', '1c46d1c9-3a60-4629-9bcf-63300649439d',
    'https://openai.com/blog', 'OFFICIAL_ISSUER', 'ALLOW', 'FIXED_ISSUER',
    'openai', 'openai.com',
    'OpenAI statements about its own products, availability, policies, safety, and release materials.',
    ARRAY['independent effectiveness','independent safety','market adoption','superiority','replication','impact'],
    'OpenAI announced', 'owner-approved-policy'
  ),
  (
    'primary-confirmed-v1', 'ebdde718-9cab-432b-a597-91d7e14f4eee',
    'https://deepmind.google/discover/blog/', 'OFFICIAL_ISSUER', 'ALLOW', 'FIXED_ISSUER',
    'google-deepmind', 'google',
    'Google DeepMind statements about its own announcements, models, research artifacts, and releases.',
    ARRAY['independent effectiveness','independent safety','market adoption','superiority','replication','impact'],
    'Google DeepMind announced', 'owner-approved-policy'
  ),
  (
    'primary-confirmed-v1', 'bd3a13c6-ea98-4e4f-aefa-4063af595653',
    'https://arxiv.org/list/cs.AI/recent', 'SCHOLARLY_PRIMARY', 'ALLOW', 'ARXIV_ARTIFACT',
    NULL, 'arxiv.org',
    'Only that the named authors published the exact preprint and self-report the methods and results stated in it.',
    ARRAY['peer review','independent validation','replication','production availability','adoption','superiority','impact'],
    'The authors report', 'owner-approved-policy'
  ),
  (
    'primary-confirmed-v1', 'd0b027dd-b139-4f56-958a-830377d59e0b',
    'https://arxiv.org/list/cs.LG/recent', 'SCHOLARLY_PRIMARY', 'ALLOW', 'ARXIV_ARTIFACT',
    NULL, 'arxiv.org',
    'Only that the named authors published the exact preprint and self-report the methods and results stated in it.',
    ARRAY['peer review','independent validation','replication','production availability','adoption','superiority','impact'],
    'The authors report', 'owner-approved-policy'
  ),
  (
    'primary-confirmed-v1', '3a4a7e80-381f-4daa-b5a0-eb20b1fd18e7',
    'https://github.blog', 'EXCLUDE', 'EXCLUDE', 'NONE', NULL, 'github.com',
    'Excluded from PRIMARY_CONFIRMED policy V1.', ARRAY[]::TEXT[], NULL,
    'owner-approved-policy'
  ),
  (
    'primary-confirmed-v1', '45e5cf9a-8539-4d91-add2-ff209a5ebcb3',
    'https://huggingface.co/blog', 'EXCLUDE', 'EXCLUDE', 'NONE', NULL, 'huggingface.co',
    'Excluded from PRIMARY_CONFIRMED policy V1.', ARRAY[]::TEXT[], NULL,
    'owner-approved-policy'
  );

CREATE OR REPLACE FUNCTION public.prevent_primary_source_policy_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'primary_source_policy_rules is append-only: % is forbidden', TG_OP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.prevent_primary_source_policy_mutation()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER primary_source_policy_rules_no_update_delete
  BEFORE UPDATE OR DELETE ON public.primary_source_policy_rules
  FOR EACH ROW EXECUTE FUNCTION public.prevent_primary_source_policy_mutation();
CREATE TRIGGER primary_source_policy_rules_no_truncate
  BEFORE TRUNCATE ON public.primary_source_policy_rules
  FOR EACH STATEMENT EXECUTE FUNCTION public.prevent_primary_source_policy_mutation();

CREATE TABLE public.signal_primary_evidence_audits (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  signal_id UUID NOT NULL REFERENCES public.signals(id) ON DELETE RESTRICT,
  observation_id UUID NOT NULL REFERENCES public.observations(id) ON DELETE RESTRICT,
  source_id UUID NOT NULL REFERENCES public.sources(id) ON DELETE RESTRICT,
  durable_run_id UUID NOT NULL REFERENCES public.sis_execution_runs(id) ON DELETE RESTRICT,
  policy_version TEXT NOT NULL,
  source_class TEXT,
  decision TEXT NOT NULL CHECK (decision IN ('APPROVED', 'REJECTED')),
  reason_code TEXT NOT NULL,
  evidence_tier TEXT NOT NULL CHECK (
    evidence_tier IN ('UNASSESSED', 'PRIMARY_CONFIRMED')
  ),
  origin_owner TEXT,
  provenance_root TEXT,
  allowed_claim_scope TEXT,
  prohibited_claims TEXT[] NOT NULL DEFAULT '{}',
  required_attribution TEXT,
  actor TEXT NOT NULL DEFAULT current_user,
  runtime TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (signal_id, policy_version)
);

ALTER TABLE public.signal_primary_evidence_audits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.signal_primary_evidence_audits FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.signal_primary_evidence_audits_id_seq
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.signal_primary_evidence_audits TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.signal_primary_evidence_audits_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.prevent_signal_primary_evidence_audit_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'signal_primary_evidence_audits is append-only: % is forbidden', TG_OP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.prevent_signal_primary_evidence_audit_mutation()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER signal_primary_evidence_audits_no_update_delete
  BEFORE UPDATE OR DELETE ON public.signal_primary_evidence_audits
  FOR EACH ROW EXECUTE FUNCTION public.prevent_signal_primary_evidence_audit_mutation();
CREATE TRIGGER signal_primary_evidence_audits_no_truncate
  BEFORE TRUNCATE ON public.signal_primary_evidence_audits
  FOR EACH STATEMENT EXECUTE FUNCTION public.prevent_signal_primary_evidence_audit_mutation();

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
    AND p_signal.qualification_score >= 6.0
    AND p_signal.sis_final >= 6.0
    AND p_signal.anti_hype_score >= 3.0
    AND cardinality(p_signal.validation_flags) = 0
    AND p_signal.quality_rule_version <> ''
    AND (
      (
        p_signal.evidence_tier = 'PRIMARY_CONFIRMED'
        AND p_signal.verification_state = 'SINGLE_SOURCE_UNVERIFIED'
        AND cardinality(p_signal.observation_ids) = 1
      )
      OR (
        p_signal.evidence_tier IN ('CORROBORATED', 'VERIFIED')
        AND p_signal.verification_state IN ('CORROBORATED', 'VERIFIED')
        AND cardinality(p_signal.observation_ids) >= 2
      )
    )
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
  v_assessments JSONB;
  v_primary_evidence JSONB;
BEGIN
  SELECT COALESCE(array_agg(DISTINCT src.provenance_root ORDER BY src.provenance_root), '{}'::TEXT[])
  INTO v_roots
  FROM public.observations obs
  JOIN public.sources src ON src.id = obs.source_id
  WHERE obs.id = ANY(NEW.observation_ids)
    AND src.provenance_root IS NOT NULL;

  WITH latest_assessments AS (
    SELECT DISTINCT ON (assessment.observation_id)
      assessment.id,
      assessment.observation_id,
      assessment.origin_owner,
      assessment.independence_status,
      assessment.assessment_basis,
      assessment.rule_version,
      assessment.actor,
      assessment.assessed_at
    FROM public.observation_provenance_assessments assessment
    WHERE assessment.observation_id = ANY(NEW.observation_ids)
    ORDER BY assessment.observation_id, assessment.assessed_at DESC, assessment.id DESC
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'assessment_id', id,
        'observation_id', observation_id,
        'origin_owner', origin_owner,
        'independence_status', independence_status,
        'assessment_basis', assessment_basis,
        'rule_version', rule_version,
        'actor', actor,
        'assessed_at', assessed_at
      ) ORDER BY observation_id
    ),
    '[]'::JSONB
  )
  INTO v_assessments
  FROM latest_assessments;

  SELECT COALESCE(
    jsonb_build_object(
      'audit_id', audit.id,
      'observation_id', audit.observation_id,
      'source_id', audit.source_id,
      'durable_run_id', audit.durable_run_id,
      'policy_version', audit.policy_version,
      'source_class', audit.source_class,
      'decision', audit.decision,
      'reason_code', audit.reason_code,
      'evidence_tier', audit.evidence_tier,
      'origin_owner', audit.origin_owner,
      'provenance_root', audit.provenance_root,
      'allowed_claim_scope', audit.allowed_claim_scope,
      'prohibited_claims', audit.prohibited_claims,
      'required_attribution', audit.required_attribution,
      'actor', audit.actor,
      'runtime', audit.runtime,
      'created_at', audit.created_at
    ),
    '{}'::JSONB
  )
  INTO v_primary_evidence
  FROM public.signal_primary_evidence_audits audit
  WHERE audit.signal_id = NEW.id
    AND audit.policy_version = 'primary-confirmed-v1';

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
      'evidence_tier', NEW.evidence_tier,
      'provenance_roots', v_roots,
      'provenance_assessments', v_assessments,
      'primary_evidence', v_primary_evidence
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
  v_assessments JSONB;
  v_assessment_count INTEGER;
  v_origin_owner_count INTEGER;
  v_invalid_assessment_count INTEGER;
  v_corroborating_status TEXT;
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

  IF cardinality(v_observation_ids) < 2 THEN
    RAISE EXCEPTION 'corroborate_draft_signal: two different observations are required';
  END IF;

  SELECT array_agg(DISTINCT src.provenance_root ORDER BY src.provenance_root)
  INTO v_roots
  FROM public.observations obs
  JOIN public.sources src ON src.id = obs.source_id
  WHERE obs.id = ANY(v_observation_ids)
    AND src.provenance_root IS NOT NULL;

  IF COALESCE(cardinality(v_roots), 0) < 2 THEN
    RAISE EXCEPTION 'corroborate_draft_signal: two distinct known provenance roots are required';
  END IF;

  WITH latest_assessments AS (
    SELECT DISTINCT ON (assessment.observation_id)
      assessment.id,
      assessment.observation_id,
      assessment.origin_owner,
      assessment.independence_status,
      assessment.assessment_basis,
      assessment.rule_version,
      assessment.actor,
      assessment.assessed_at
    FROM public.observation_provenance_assessments assessment
    WHERE assessment.observation_id = ANY(v_observation_ids)
    ORDER BY assessment.observation_id, assessment.assessed_at DESC, assessment.id DESC
  )
  SELECT
    count(*)::INTEGER,
    count(DISTINCT origin_owner)::INTEGER,
    count(*) FILTER (
      WHERE independence_status NOT IN ('ORIGIN_CONFIRMED', 'INDEPENDENTLY_VERIFIED')
    )::INTEGER,
    max(independence_status) FILTER (WHERE observation_id = p_observation_id),
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'assessment_id', id,
          'observation_id', observation_id,
          'origin_owner', origin_owner,
          'independence_status', independence_status,
          'assessment_basis', assessment_basis,
          'rule_version', rule_version,
          'actor', actor,
          'assessed_at', assessed_at
        ) ORDER BY observation_id
      ),
      '[]'::JSONB
    )
  INTO
    v_assessment_count,
    v_origin_owner_count,
    v_invalid_assessment_count,
    v_corroborating_status,
    v_assessments
  FROM latest_assessments;

  IF v_assessment_count <> cardinality(v_observation_ids) THEN
    RAISE EXCEPTION 'corroborate_draft_signal: every observation requires an explicit provenance assessment';
  END IF;

  IF v_invalid_assessment_count > 0 THEN
    RAISE EXCEPTION 'corroborate_draft_signal: UNKNOWN or SAME_ORIGIN evidence cannot corroborate';
  END IF;

  IF v_corroborating_status <> 'INDEPENDENTLY_VERIFIED' THEN
    RAISE EXCEPTION 'corroborate_draft_signal: corroborating evidence is not independently verified';
  END IF;

  IF v_origin_owner_count < 2 THEN
    RAISE EXCEPTION 'corroborate_draft_signal: two distinct confirmed origin owners are required';
  END IF;

  v_signal.observation_ids := v_observation_ids;
  v_signal.verification_state := CASE
    WHEN v_origin_owner_count >= 3 THEN 'VERIFIED'
    ELSE 'CORROBORATED'
  END;
  v_signal.evidence_tier := CASE
    WHEN v_origin_owner_count >= 3 THEN 'VERIFIED'
    ELSE 'CORROBORATED'
  END;
  v_signal.has_verified_source := public.compute_has_verified_source(v_observation_ids);
  v_signal.status := 'ACTIVE';
  v_signal.quality_state := 'APPROVED';
  v_signal.quality_reason_codes := '{}'::TEXT[];
  v_signal.quality_rule_version := 'draft-corroboration-approval-v2';
  v_signal.quality_evaluated_at := now();
  v_signal.quarantined_at := NULL;

  IF NOT public.signal_meets_quality_approval_predicates(v_signal) THEN
    RAISE EXCEPTION 'corroborate_draft_signal: quality predicates are not satisfied';
  END IF;

  UPDATE public.signals
  SET observation_ids = v_signal.observation_ids,
      verification_state = v_signal.verification_state,
      evidence_tier = v_signal.evidence_tier,
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
    evidence_provenance_roots, provenance_assessments, rule_version
  ) VALUES (
    p_signal_id, p_observation_id, v_observation_ids,
    v_roots, v_assessments, 'draft-corroboration-approval-v2'
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
  'Service-role-only, explicit DRAFT approval operation. Atomically links one existing eligible observation, requires two explicit independently assessed origin owners plus distinct source roots, appends audit records, and transitions to APPROVED/ACTIVE. No provider or automatic invocation.';

-- Normal Durable SIS operation for one newly finalized DRAFT/SIGNAL. It is
-- intentionally not a public or manual promotion API: the run identity and
-- READY_TO_FINALIZE state must match the Signal's exact observation.
CREATE OR REPLACE FUNCTION public.apply_primary_confirmed_signal_v1(
  p_signal_id UUID,
  p_observation_id UUID,
  p_run_id UUID,
  p_runtime TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_signal public.signals%ROWTYPE;
  v_observation public.observations%ROWTYPE;
  v_source public.sources%ROWTYPE;
  v_run public.sis_execution_runs%ROWTYPE;
  v_policy public.primary_source_policy_rules%ROWTYPE;
  v_existing public.signal_primary_evidence_audits%ROWTYPE;
  v_reason_code TEXT;
  v_origin_owner TEXT;
  v_artifact_id TEXT;
BEGIN
  IF btrim(coalesce(p_runtime, '')) = '' THEN
    RAISE EXCEPTION 'apply_primary_confirmed_signal_v1: runtime is required';
  END IF;

  SELECT * INTO v_signal FROM public.signals WHERE id = p_signal_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'apply_primary_confirmed_signal_v1: signal not found';
  END IF;

  SELECT * INTO v_existing
  FROM public.signal_primary_evidence_audits
  WHERE signal_id = p_signal_id AND policy_version = 'primary-confirmed-v1';
  IF FOUND THEN
    RETURN jsonb_build_object(
      'applied', v_existing.decision = 'APPROVED',
      'duplicate', true,
      'decision', v_existing.decision,
      'reason_code', v_existing.reason_code,
      'evidence_tier', v_existing.evidence_tier
    );
  END IF;

  SELECT * INTO v_observation
  FROM public.observations WHERE id = p_observation_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'apply_primary_confirmed_signal_v1: observation not found';
  END IF;

  SELECT * INTO v_source FROM public.sources WHERE id = v_observation.source_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'apply_primary_confirmed_signal_v1: source not found';
  END IF;

  SELECT * INTO v_run FROM public.sis_execution_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'apply_primary_confirmed_signal_v1: run not found';
  END IF;

  SELECT * INTO v_policy
  FROM public.primary_source_policy_rules
  WHERE policy_version = 'primary-confirmed-v1'
    AND source_id = v_source.id;

  v_reason_code := CASE
    WHEN v_signal.status <> 'DRAFT'
      OR v_signal.quality_state <> 'PENDING'
      OR v_signal.intelligence_type <> 'SIGNAL'
      THEN 'SIGNAL_STATE_INELIGIBLE'
    WHEN v_signal.engine_version <> 'durable-sis-v1'
      OR v_signal.metadata->>'durable_sis_run_id' <> p_run_id::TEXT
      OR v_run.observation_id <> p_observation_id
      OR v_run.status <> 'READY_TO_FINALIZE'
      OR v_run.finalization_outcome <> 'SIGNAL'
      THEN 'DURABLE_RUN_MISMATCH'
    WHEN v_signal.observation_ids <> ARRAY[p_observation_id]::UUID[]
      OR v_observation.processed
      OR v_observation.signal_id IS NOT NULL
      THEN 'OBSERVATION_STATE_INELIGIBLE'
    WHEN v_source.status <> 'ACTIVE' THEN 'SOURCE_INACTIVE'
    WHEN v_policy.source_id IS NULL THEN 'SOURCE_POLICY_UNREGISTERED'
    WHEN v_source.url <> v_policy.registered_source_url THEN 'SOURCE_REGISTRATION_MISMATCH'
    WHEN v_policy.policy_action = 'EXCLUDE' THEN 'SOURCE_POLICY_EXCLUDED'
    WHEN v_observation.url_verified_ok IS NOT TRUE THEN 'SOURCE_URL_UNVERIFIED'
    WHEN v_signal.sis_final < 6.0 THEN 'SIS_BELOW_THRESHOLD'
    WHEN v_signal.qualification_score < 6.0 THEN 'QUALIFICATION_BELOW_THRESHOLD'
    WHEN v_signal.anti_hype_score < 3.0 THEN 'ANTI_HYPE_BELOW_THRESHOLD'
    WHEN cardinality(v_signal.validation_flags) <> 0 THEN 'VALIDATION_FLAGS_PRESENT'
    WHEN position(lower(v_policy.required_attribution) IN lower(ltrim(v_signal.description))) <> 1
      THEN 'PUBLIC_ATTRIBUTION_MISSING'
    ELSE NULL
  END;

  IF v_reason_code IS NULL AND v_policy.origin_owner_strategy = 'ARXIV_ARTIFACT' THEN
    IF v_observation.url !~ '^https://arxiv[.]org/abs/[0-9]{4}[.][0-9]{4,5}(v[0-9]+)?$' THEN
      v_reason_code := 'ARXIV_ARTIFACT_URL_INVALID';
    ELSE
      v_artifact_id := regexp_replace(
        v_observation.url,
        '^https://arxiv[.]org/abs/([0-9]{4}[.][0-9]{4,5})(v[0-9]+)?$',
        E'\\1'
      );
      v_origin_owner := 'arxiv-authors:' || lower(v_artifact_id);
    END IF;
  ELSIF v_reason_code IS NULL THEN
    v_origin_owner := v_policy.fixed_origin_owner;
  END IF;

  IF v_reason_code IS NOT NULL THEN
    INSERT INTO public.signal_primary_evidence_audits (
      signal_id, observation_id, source_id, durable_run_id, policy_version,
      source_class, decision, reason_code, evidence_tier, origin_owner,
      provenance_root, allowed_claim_scope, prohibited_claims,
      required_attribution, runtime
    ) VALUES (
      p_signal_id, p_observation_id, v_source.id, p_run_id, 'primary-confirmed-v1',
      v_policy.source_class, 'REJECTED', v_reason_code, 'UNASSESSED', v_origin_owner,
      v_policy.provenance_root, v_policy.allowed_claim_scope,
      coalesce(v_policy.prohibited_claims, '{}'::TEXT[]),
      v_policy.required_attribution, p_runtime
    );
    RETURN jsonb_build_object(
      'applied', false,
      'duplicate', false,
      'decision', 'REJECTED',
      'reason_code', v_reason_code,
      'evidence_tier', 'UNASSESSED'
    );
  END IF;

  v_signal.status := 'ACTIVE';
  v_signal.quality_state := 'APPROVED';
  v_signal.evidence_tier := 'PRIMARY_CONFIRMED';
  v_signal.verification_state := 'SINGLE_SOURCE_UNVERIFIED';
  v_signal.has_verified_source := public.compute_has_verified_source(v_signal.observation_ids);
  v_signal.quality_reason_codes := '{}'::TEXT[];
  v_signal.quality_rule_version := 'primary-confirmed-v1';
  v_signal.quality_evaluated_at := now();
  v_signal.quarantined_at := NULL;

  IF NOT public.signal_meets_quality_approval_predicates(v_signal) THEN
    RAISE EXCEPTION 'apply_primary_confirmed_signal_v1: quality predicates are not satisfied';
  END IF;

  INSERT INTO public.signal_primary_evidence_audits (
    signal_id, observation_id, source_id, durable_run_id, policy_version,
    source_class, decision, reason_code, evidence_tier, origin_owner,
    provenance_root, allowed_claim_scope, prohibited_claims,
    required_attribution, runtime
  ) VALUES (
    p_signal_id, p_observation_id, v_source.id, p_run_id, 'primary-confirmed-v1',
    v_policy.source_class, 'APPROVED', 'PRIMARY_POLICY_MATCH', 'PRIMARY_CONFIRMED',
    v_origin_owner, v_policy.provenance_root, v_policy.allowed_claim_scope,
    v_policy.prohibited_claims, v_policy.required_attribution, p_runtime
  );

  UPDATE public.signals
  SET status = v_signal.status,
      quality_state = v_signal.quality_state,
      evidence_tier = v_signal.evidence_tier,
      verification_state = v_signal.verification_state,
      has_verified_source = v_signal.has_verified_source,
      quality_reason_codes = v_signal.quality_reason_codes,
      quality_rule_version = v_signal.quality_rule_version,
      quality_evaluated_at = v_signal.quality_evaluated_at,
      quarantined_at = v_signal.quarantined_at
  WHERE id = p_signal_id;

  RETURN jsonb_build_object(
    'applied', true,
    'duplicate', false,
    'decision', 'APPROVED',
    'reason_code', 'PRIMARY_POLICY_MATCH',
    'evidence_tier', 'PRIMARY_CONFIRMED',
    'status', 'ACTIVE',
    'quality_state', 'APPROVED',
    'verification_state', 'SINGLE_SOURCE_UNVERIFIED'
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.apply_primary_confirmed_signal_v1(UUID, UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_primary_confirmed_signal_v1(UUID, UUID, UUID, TEXT)
  TO service_role;

COMMENT ON FUNCTION public.apply_primary_confirmed_signal_v1(UUID, UUID, UUID, TEXT) IS
  'Durable-finalization-only PRIMARY_CONFIRMED V1 operation. Uses exact versioned source policy, preserves SINGLE_SOURCE_UNVERIFIED, appends allow/deny audit, and atomically transitions an eligible new DRAFT to APPROVED/ACTIVE.';

-- Wire PRIMARY_CONFIRMED into the existing crash-safe FINALIZE transaction.
-- A policy rejection is a fully audited DRAFT/PENDING outcome; an SQL error
-- rolls back Signal, decision, observation, audit, finalization, and queue
-- archive together so redelivery remains safe.
CREATE OR REPLACE FUNCTION public.finalize_durable_sis_v1(
  p_run_id UUID,
  p_message_id BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pgmq, extensions
AS $$
DECLARE
  v_run public.sis_execution_runs%ROWTYPE;
  v_existing public.sis_execution_finalizations%ROWTYPE;
  v_signal_id UUID;
  v_decision_id UUID;
  v_primary_result JSONB;
BEGIN
  SELECT * INTO v_run FROM public.sis_execution_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'run missing'; END IF;

  SELECT * INTO v_existing
  FROM public.sis_execution_finalizations
  WHERE run_id = p_run_id;
  IF FOUND THEN
    PERFORM pgmq.archive('durable_sis_v1', p_message_id);
    RETURN jsonb_build_object(
      'outcome', v_existing.outcome,
      'signal_id', v_existing.signal_id,
      'decision_log_id', v_existing.decision_log_id,
      'duplicate', true
    );
  END IF;

  IF v_run.status <> 'READY_TO_FINALIZE' THEN RAISE EXCEPTION 'run not ready'; END IF;
  IF v_run.finalization_outcome IS NULL
    OR v_run.finalization_signal IS NULL
    OR v_run.finalization_decision IS NULL THEN
    RAISE EXCEPTION 'finalization payload missing';
  END IF;

  PERFORM 1 FROM public.observations WHERE id = v_run.observation_id FOR UPDATE;
  IF EXISTS (
    SELECT 1 FROM public.signals WHERE v_run.observation_id = ANY(observation_ids)
  ) OR EXISTS (
    SELECT 1
    FROM public.signal_decision_log decision
    WHERE decision.observation_id = v_run.observation_id
      AND NOT EXISTS (
        SELECT 1 FROM public.sis_execution_recoveries recovery
        WHERE recovery.decision_log_id = decision.id
      )
  ) THEN
    RAISE EXCEPTION 'observation already finalized';
  END IF;

  IF v_run.finalization_outcome IN ('SIGNAL', 'WEAK_SIGNAL') THEN
    INSERT INTO public.signals (
      title, description, category, status, impact_factor, actor_factor, novelty_factor,
      verifiability_factor, strategic_factor, authority_factor, corroboration_factor,
      specificity_factor, category_confidence_factor, consistency_factor, signal_score,
      confidence_score, momentum_score, intelligence_type, quality_state,
      quality_reason_codes, quality_rule_version, observation_ids, sis_novelty,
      sis_importance, sis_urgency, sis_confidence, sis_final, qualification_score,
      human_relevance_flags, anti_hype_score, anti_hype_flags, relevance_horizon,
      lifecycle_state, engine_version, has_verified_source, metadata
    ) VALUES (
      v_run.finalization_signal->>'title',
      v_run.finalization_signal->>'description',
      (v_run.finalization_signal->>'category')::public.signal_category,
      CASE WHEN v_run.finalization_outcome = 'WEAK_SIGNAL' THEN 'WEAK' ELSE 'DRAFT' END::public.signal_status,
      (v_run.finalization_signal->>'impact_factor')::SMALLINT,
      (v_run.finalization_signal->>'actor_factor')::SMALLINT,
      (v_run.finalization_signal->>'novelty_factor')::SMALLINT,
      (v_run.finalization_signal->>'verifiability_factor')::SMALLINT,
      (v_run.finalization_signal->>'strategic_factor')::SMALLINT,
      (v_run.finalization_signal->>'authority_factor')::SMALLINT,
      (v_run.finalization_signal->>'corroboration_factor')::SMALLINT,
      (v_run.finalization_signal->>'specificity_factor')::SMALLINT,
      (v_run.finalization_signal->>'category_confidence_factor')::SMALLINT,
      7,
      (v_run.finalization_signal->>'signal_score')::SMALLINT,
      (v_run.finalization_signal->>'confidence_score')::SMALLINT,
      coalesce((v_run.finalization_signal->>'momentum_score')::SMALLINT, 0),
      v_run.finalization_outcome,
      'PENDING',
      ARRAY['AWAITING_QUALITY_REVIEW'],
      'quality-foundation-v1',
      ARRAY[v_run.observation_id],
      (v_run.finalization_decision->>'sis_novelty')::NUMERIC,
      (v_run.finalization_decision->>'sis_importance')::NUMERIC,
      (v_run.finalization_decision->>'sis_urgency')::NUMERIC,
      (v_run.finalization_decision->>'sis_confidence')::NUMERIC,
      (v_run.finalization_decision->>'sis_final')::NUMERIC,
      (v_run.finalization_decision->>'sis_final')::NUMERIC,
      coalesce(v_run.finalization_decision->'human_relevance', '{}'::JSONB),
      (v_run.finalization_decision->>'anti_hype_score')::NUMERIC,
      coalesce(v_run.finalization_decision->'anti_hype_flags', '{}'::JSONB),
      v_run.finalization_decision->>'relevance_horizon',
      'ACTIVE',
      'durable-sis-v1',
      false,
      jsonb_build_object('durable_sis_run_id', p_run_id)
    ) RETURNING id INTO v_signal_id;

    IF v_run.finalization_outcome = 'SIGNAL' THEN
      SELECT public.apply_primary_confirmed_signal_v1(
        v_signal_id,
        v_run.observation_id,
        p_run_id,
        'durable-sis-v1-finalize'
      ) INTO v_primary_result;
    END IF;
  ELSIF v_run.finalization_outcome <> 'DISCARD' THEN
    RAISE EXCEPTION 'invalid outcome';
  END IF;

  INSERT INTO public.signal_decision_log (
    signal_id, observation_id, decision, rejection_code, rejection_reason,
    engine_justification, qualification_score, sis_novelty, sis_importance,
    sis_urgency, sis_confidence, sis_final, human_relevance_breakdown,
    anti_hype_score, anti_hype_flags, engine_version
  ) VALUES (
    v_signal_id, v_run.observation_id, v_run.finalization_outcome,
    v_run.finalization_decision->>'rejection_code',
    v_run.finalization_decision->>'rejection_reason',
    v_run.finalization_decision->>'engine_justification',
    (v_run.finalization_decision->>'sis_final')::NUMERIC,
    (v_run.finalization_decision->>'sis_novelty')::NUMERIC,
    (v_run.finalization_decision->>'sis_importance')::NUMERIC,
    (v_run.finalization_decision->>'sis_urgency')::NUMERIC,
    (v_run.finalization_decision->>'sis_confidence')::NUMERIC,
    (v_run.finalization_decision->>'sis_final')::NUMERIC,
    coalesce(v_run.finalization_decision->'human_relevance', '{}'::JSONB),
    (v_run.finalization_decision->>'anti_hype_score')::NUMERIC,
    coalesce(v_run.finalization_decision->'anti_hype_flags', '{}'::JSONB),
    'durable-sis-v1'
  ) RETURNING id INTO v_decision_id;

  UPDATE public.observations
  SET processed = true,
      signal_id = v_signal_id,
      processing_error = NULL,
      qualification_result = v_run.finalization_outcome,
      rejection_code = v_run.finalization_decision->>'rejection_code',
      rejection_reason = v_run.finalization_decision->>'rejection_reason',
      engine_version = 'durable-sis-v1'
  WHERE id = v_run.observation_id;

  INSERT INTO public.sis_execution_finalizations (
    run_id, observation_id, outcome, signal_id, decision_log_id
  ) VALUES (
    p_run_id, v_run.observation_id, v_run.finalization_outcome,
    v_signal_id, v_decision_id
  );

  PERFORM pgmq.archive('durable_sis_v1', p_message_id);
  UPDATE public.sis_execution_runs
  SET status = 'FINALIZED', updated_at = now()
  WHERE id = p_run_id;

  RETURN jsonb_build_object(
    'outcome', v_run.finalization_outcome,
    'signal_id', v_signal_id,
    'decision_log_id', v_decision_id,
    'primary_evidence', v_primary_result,
    'duplicate', false
  );
END;
$$;
