\set ON_ERROR_STOP on

-- READ BEFORE RUNNING
-- Scope: exactly nine production observations proven lost after HTTP 200
-- structured SIS output failed JSON/schema validation on 2026-08-23/24.
-- This is a one-time, idempotent repair script, not a migration.
-- It does not create Signals or decisions and does not run enrichment.

begin;

with repair_targets(id) as (
  values
    ('e4275483-39e4-4441-84a2-0a1df546cf07'::uuid),
    ('ec86e548-8394-4c45-8353-7ba588f23cf3'::uuid),
    ('fc22b35a-776b-4666-aabc-64ea1a198c34'::uuid),
    ('bcf826e4-069c-4627-a4ab-6635ce3e1f7e'::uuid),
    ('5e0938e3-feb2-4531-9ebb-1e53164d219d'::uuid),
    ('cb043c56-7be5-4e9d-9144-2c9c407d9655'::uuid),
    ('91c78285-f310-4dfa-a0ca-0953e8cfdd40'::uuid),
    ('948419ea-27e9-4213-b692-f80c04611cfa'::uuid),
    ('de90407c-d4b9-4eee-862f-12a549f9544d'::uuid)
), repaired as (
  update public.observations as observation
  set
    processed = false,
    processing_error = null,
    metadata = coalesce(observation.metadata, '{}'::jsonb) || jsonb_build_object(
      'retry_after', to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'repair_key', 'repair_lost_sis_structured_output_20260823_v1',
      'repair_audit', jsonb_build_object(
        'reason', 'Requeued after confirmed terminalization of HTTP 200 invalid SIS structured output',
        'repaired_at', clock_timestamp(),
        'source', 'approved_one_time_repair_script'
      )
    )
  from repair_targets
  where observation.id = repair_targets.id
    and observation.processed is true
    and observation.signal_id is null
    and observation.rejection_code is null
    and observation.processing_error like 'SIS: [agent:classifier] All models failed:%'
    and observation.metadata->>'repair_key' is distinct from 'repair_lost_sis_structured_output_20260823_v1'
  returning observation.id
)
select id from repaired order by id;

commit;
