-- Unlock Durable SIS for one explicitly selected ordinary observation at a
-- time. This migration is schema/function-only: it preserves every existing
-- run, attempt, recovery, decision and Signal, leaves execution disabled, and
-- does not enqueue work.

alter table public.sis_execution_controls
  drop constraint if exists sis_execution_controls_control_observation_id_check;

alter table public.sis_execution_runs
  drop constraint if exists sis_execution_runs_observation_id_check;

drop index if exists public.sis_execution_runs_one_nonfailed_per_observation_idx;

create unique index sis_execution_runs_one_nonfailed_per_observation_idx
  on public.sis_execution_runs(observation_id)
  where status <> 'FAILED';

drop function if exists public.start_durable_sis_v1_control(text,text,integer,text);

create function public.start_durable_sis_v1_control(
  p_observation_id uuid,
  p_provider text,
  p_model text,
  p_units integer,
  p_unit_kind text
) returns jsonb
language plpgsql security definer
set search_path = public, pgmq, extensions
as $$
declare
  v_control public.sis_execution_controls%rowtype;
  v_run public.sis_execution_runs%rowtype;
  v_attempt_id uuid;
  v_message_id bigint;
begin
  if p_observation_id is null then
    raise exception 'durable SIS canary observation missing';
  end if;

  select * into v_control from public.sis_execution_controls
  where control_key = 'durable_sis_v1_control_20260825' for update;

  if not found then raise exception 'durable SIS control missing'; end if;
  if not v_control.execution_enabled then
    update public.sis_execution_runs set status = 'PAUSED', updated_at = now()
    where control_key = v_control.control_key and status not in ('FINALIZED','FAILED');
    return jsonb_build_object('status','PAUSED','started',false);
  end if;

  if p_provider not in ('groq','cloudflare') or nullif(p_model,'') is null or
     p_units is null or p_units <= 0 then
    raise exception 'invalid initial provider/model/budget';
  end if;

  if not exists (
    select 1
    from public.observations observation
    join public.sources source on source.id = observation.source_id
    where observation.id = p_observation_id
      and observation.processed is false
      and observation.signal_id is null
      and observation.qualification_result is null
      and observation.rejection_code is null
      and observation.url_verified_ok is true
      and nullif(btrim(observation.title),'') is not null
      and nullif(btrim(observation.content),'') is not null
      and source.status = 'ACTIVE'
      and not exists (
        select 1 from public.signals signal
        where p_observation_id = any(signal.observation_ids)
      )
      and not exists (
        select 1 from public.signal_decision_log decision
        where decision.observation_id = observation.id
          and not exists (
            select 1 from public.sis_execution_recoveries recovery
            where recovery.decision_log_id = decision.id
          )
      )
  ) then
    return jsonb_build_object('status','INELIGIBLE','started',false);
  end if;

  select * into v_run from public.sis_execution_runs
  where observation_id = p_observation_id
    and status <> 'FAILED'
  order by created_at desc
  limit 1;
  if found then
    return jsonb_build_object('status',v_run.status,'started',false,'run_id',v_run.id);
  end if;

  update public.sis_execution_controls
  set control_observation_id = p_observation_id, updated_at = now()
  where control_key = v_control.control_key;

  insert into public.sis_execution_runs(control_key, observation_id, status)
  values (v_control.control_key, p_observation_id, 'QUEUED')
  returning * into v_run;

  insert into public.sis_execution_attempts(run_id, stage, ordinal, provider, model)
  values (v_run.id, 'CLASSIFIER', 1, p_provider, p_model)
  returning id into v_attempt_id;

  if not public.reserve_durable_sis_v1_budget(v_attempt_id, p_units, p_unit_kind) then
    raise exception 'durable SIS budget unavailable';
  end if;

  select pgmq.send('durable_sis_v1', jsonb_build_object('attempt_id',v_attempt_id)) into v_message_id;
  update public.sis_execution_attempts set pgmq_message_id = v_message_id where id = v_attempt_id;
  return jsonb_build_object('status','QUEUED','started',true,'run_id',v_run.id);
end
$$;

revoke all on function public.start_durable_sis_v1_control(uuid,text,text,integer,text)
  from public, anon, authenticated;
grant execute on function public.start_durable_sis_v1_control(uuid,text,text,integer,text)
  to service_role;
