\set ON_ERROR_STOP on

-- READ BEFORE RUNNING
-- Scope: exactly the first three allowlisted observations terminalized by the
-- failed targeted SIS replay on 2026-08-24.
-- This is a one-time, idempotent repair script, not a migration.
-- It only returns those rows to the queue. It does not create Signals,
-- decisions, approvals, or invoke enrichment.

begin;

with repair_targets(id) as (
  values
    ('e4275483-39e4-4441-84a2-0a1df546cf07'::uuid),
    ('ec86e548-8394-4c45-8353-7ba588f23cf3'::uuid),
    ('fc22b35a-776b-4666-aabc-64ea1a198c34'::uuid)
), repaired as (
  update public.observations as observation
  set
    processed = false,
    processing_error = null,
    metadata = jsonb_set(
      coalesce(observation.metadata, '{}'::jsonb)
        - 'targeted_sis_replay_key'
        - 'targeted_sis_replay_audit',
      '{targeted_sis_replay_history}',
      coalesce(observation.metadata->'targeted_sis_replay_history', '[]'::jsonb)
        || jsonb_build_array(jsonb_build_object(
          'replay_key', observation.metadata->>'targeted_sis_replay_key',
          'replay_audit', observation.metadata->'targeted_sis_replay_audit',
          'terminal_processing_error', observation.processing_error,
          'repair_reason', 'Requeued after mixed provider/structured-output failure was incorrectly terminalized',
          'repaired_at', clock_timestamp()
        )),
      true
    ) || jsonb_build_object(
      'retry_after', to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'targeted_sis_repair_key', 'repair_mixed_sis_replay_terminalization_20260824_v1',
      'targeted_sis_repair_audit', jsonb_build_object(
        'reason', 'Restore retryability after mixed provider/structured-output chain',
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
    and observation.metadata->>'repair_key' = 'repair_lost_sis_structured_output_20260823_v1'
    and observation.metadata->>'targeted_sis_replay_key' = 'targeted_sis_replay_20260823_v1'
    and observation.metadata->>'targeted_sis_repair_key'
      is distinct from 'repair_mixed_sis_replay_terminalization_20260824_v1'
  returning observation.id
)
select id from repaired order by id;

commit;
