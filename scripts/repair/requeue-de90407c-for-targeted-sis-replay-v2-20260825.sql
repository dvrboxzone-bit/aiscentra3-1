\set ON_ERROR_STOP on

-- READ BEFORE RUNNING
-- Scope: exactly de90407c-d4b9-4eee-862f-12a549f9544d, the only allowlisted
-- observation left terminal after targeted SIS replay v1. This is an audited,
-- idempotent queue repair, not a migration. It never creates or updates a
-- Signal or signal_decision_log row and it preserves all v1 replay metadata.

begin;
set local statement_timeout = '10s';
set local lock_timeout = '5s';
select pg_advisory_xact_lock(hashtext('targeted-sis-replay-v2-de90407c-repair'));

create temporary table sis_replay_v2_repair_preflight on commit drop as
select
  observation.id,
  observation.processed,
  observation.processing_error,
  observation.signal_id,
  observation.rejection_code,
  observation.metadata,
  (
    select count(*)
    from public.signals as signal
    where observation.id = any(coalesce(signal.observation_ids, '{}'::uuid[]))
  ) as signal_count,
  (
    select count(*)
    from public.signal_decision_log as decision
    where decision.observation_id = observation.id
  ) as decision_count
from public.observations as observation
where observation.id = 'de90407c-d4b9-4eee-862f-12a549f9544d'::uuid;

do $$
declare
  preflight sis_replay_v2_repair_preflight%rowtype;
begin
  if (select count(*) from sis_replay_v2_repair_preflight) <> 1 then
    raise exception 'Preflight failed: exact target observation was not found';
  end if;

  select * into strict preflight from sis_replay_v2_repair_preflight;

  if preflight.signal_id is not null
    or preflight.rejection_code is not null
    or preflight.signal_count <> 0
    or preflight.decision_count <> 0
  then
    raise exception 'Preflight failed: target has Signal, rejection, or decision-log history';
  end if;

  if not (
    (
      preflight.processed is true
      and preflight.processing_error like 'SIS: [agent:classifier] All models failed:%'
      and preflight.metadata->>'repair_key' = 'repair_lost_sis_structured_output_20260823_v1'
      and preflight.metadata->>'targeted_sis_replay_v2_key' is null
      and preflight.metadata->>'targeted_sis_repair_v2_key'
        is distinct from 'repair_de90407c_for_targeted_sis_replay_20260825_v2'
    )
    or (
      preflight.processed is false
      and preflight.processing_error is null
      and preflight.metadata->>'targeted_sis_repair_v2_key'
        = 'repair_de90407c_for_targeted_sis_replay_20260825_v2'
    )
  ) then
    raise exception 'Preflight failed: target state is neither eligible nor already repaired';
  end if;
end
$$;

create temporary table sis_replay_v2_repair_result (id uuid primary key) on commit drop;

with repaired as (
  update public.observations as observation
  set
    processed = false,
    processing_error = null,
    metadata = jsonb_set(
      coalesce(observation.metadata, '{}'::jsonb),
      '{targeted_sis_repair_v2_history}',
      coalesce(observation.metadata->'targeted_sis_repair_v2_history', '[]'::jsonb)
        || jsonb_build_array(jsonb_build_object(
          'terminal_processing_error', observation.processing_error,
          'repair_reason', 'Requeued for SIS replay v2 after the v1 output-cap incident',
          'repaired_at', clock_timestamp(),
          'source', 'approved_one_time_repair_script'
        )),
      true
    ) || jsonb_build_object(
      'retry_after', to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'targeted_sis_repair_v2_key', 'repair_de90407c_for_targeted_sis_replay_20260825_v2',
      'targeted_sis_repair_v2_audit', jsonb_build_object(
        'reason', 'Restore the sole terminal observation for one v2 campaign attempt',
        'repaired_at', clock_timestamp(),
        'source', 'approved_one_time_repair_script'
      )
    )
  where observation.id = 'de90407c-d4b9-4eee-862f-12a549f9544d'::uuid
    and observation.processed is true
    and observation.signal_id is null
    and observation.rejection_code is null
    and observation.processing_error like 'SIS: [agent:classifier] All models failed:%'
    and observation.metadata->>'repair_key' = 'repair_lost_sis_structured_output_20260823_v1'
    and observation.metadata->>'targeted_sis_replay_v2_key' is null
    and observation.metadata->>'targeted_sis_repair_v2_key'
      is distinct from 'repair_de90407c_for_targeted_sis_replay_20260825_v2'
  returning observation.id
)
insert into sis_replay_v2_repair_result(id)
select id from repaired;

do $$
declare
  preflight sis_replay_v2_repair_preflight%rowtype;
  post_signal_count bigint;
  post_decision_count bigint;
begin
  if (select count(*) from sis_replay_v2_repair_result) > 1 then
    raise exception 'Postcheck failed: repair changed more than one observation';
  end if;

  select * into strict preflight from sis_replay_v2_repair_preflight;

  if not exists (
    select 1
    from public.observations as observation
    where observation.id = preflight.id
      and observation.processed is false
      and observation.processing_error is null
      and observation.signal_id is null
      and observation.rejection_code is null
      and observation.metadata->>'targeted_sis_repair_v2_key'
        = 'repair_de90407c_for_targeted_sis_replay_20260825_v2'
      and observation.metadata->>'targeted_sis_replay_v2_key' is null
      and observation.metadata->'targeted_sis_replay_key'
        is not distinct from preflight.metadata->'targeted_sis_replay_key'
      and observation.metadata->'targeted_sis_replay_audit'
        is not distinct from preflight.metadata->'targeted_sis_replay_audit'
  ) then
    raise exception 'Postcheck failed: target queue state or preserved v1 history is invalid';
  end if;

  select count(*) into post_signal_count
  from public.signals as signal
  where preflight.id = any(coalesce(signal.observation_ids, '{}'::uuid[]));

  select count(*) into post_decision_count
  from public.signal_decision_log as decision
  where decision.observation_id = preflight.id;

  if post_signal_count <> preflight.signal_count
    or post_decision_count <> preflight.decision_count
  then
    raise exception 'Postcheck failed: Signal or decision-log counts changed';
  end if;
end
$$;

select
  (select count(*) from sis_replay_v2_repair_result) as changed_count,
  observation.id,
  observation.processed,
  observation.processing_error,
  observation.metadata->>'targeted_sis_repair_v2_key' as repair_key
from public.observations as observation
where observation.id = 'de90407c-d4b9-4eee-862f-12a549f9544d'::uuid;

commit;
