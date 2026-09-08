-- Separate legacy enrichment admission from one exact Durable SIS canary.
-- The existing execution_enabled flag remains the global kill-switch. A
-- versioned scope plus bounded leases closes the check/use race without a new
-- lease table. No work is enqueued and the installed state remains disabled.

alter table public.sis_execution_controls
  add column execution_scope text not null default 'LEGACY';

alter table public.sis_execution_controls
  add constraint sis_execution_controls_execution_scope_check
  check (execution_scope in ('LEGACY', 'DURABLE_CANARY'));

create or replace function public.acquire_legacy_enrichment_admission(
  p_holder text,
  p_ttl_seconds integer
) returns text
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_control public.sis_execution_controls%rowtype;
  v_expired_canary_holder text;
begin
  if nullif(btrim(p_holder), '') is null or p_ttl_seconds not between 1 and 300 then
    return 'STATE_UNAVAILABLE';
  end if;

  perform pg_advisory_xact_lock(hashtext('aiscentra.execution-admission.v1'));
  select * into v_control
  from public.sis_execution_controls
  where control_key = 'durable_sis_v1_control_20260825'
  for update;

  if not found then return 'STATE_UNAVAILABLE'; end if;
  if v_control.execution_enabled is false then return 'DISABLED'; end if;
  if v_control.execution_scope <> 'LEGACY' then
    select holder into v_expired_canary_holder
    from public.execution_locks
    where lock_name = 'durable-sis-canary' and expires_at < now()
    for update;
    if v_control.execution_scope = 'DURABLE_CANARY' and found then
      -- A cancelled/timed-out workflow may never run its always() cleanup.
      -- Reconcile it under the same admission mutex, but never admit this
      -- request in the cleanup transaction.
      perform public.stop_durable_sis_v1_canary(v_expired_canary_holder);
    end if;
    return 'SCOPE_BLOCKED';
  end if;

  insert into public.execution_locks(lock_name, holder, acquired_at, expires_at)
  values (
    'legacy-enrichment-admission:' || p_holder,
    p_holder,
    now(),
    now() + make_interval(secs => p_ttl_seconds)
  );
  return 'ADMITTED';
exception when others then
  return 'STATE_UNAVAILABLE';
end
$$;

drop function if exists public.start_durable_sis_v1_control(uuid,text,text,integer,text);

create function public.start_durable_sis_v1_control(
  p_observation_id uuid,
  p_provider text,
  p_model text,
  p_units integer,
  p_unit_kind text,
  p_lease_holder text,
  p_lease_seconds integer default 780
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
  if p_observation_id is null or nullif(btrim(p_lease_holder), '') is null or
     p_lease_seconds not between 60 and 900 then
    raise exception 'invalid durable SIS canary lease';
  end if;
  if p_provider not in ('groq','cloudflare') or nullif(p_model,'') is null or
     p_units is null or p_units <= 0 then
    raise exception 'invalid initial provider/model/budget';
  end if;

  perform pg_advisory_xact_lock(hashtext('aiscentra.execution-admission.v1'));
  select * into v_control from public.sis_execution_controls
  where control_key = 'durable_sis_v1_control_20260825' for update;

  if not found then raise exception 'durable SIS control missing'; end if;
  if v_control.execution_enabled or v_control.execution_scope <> 'LEGACY' then
    return jsonb_build_object('status','BUSY','started',false);
  end if;
  if exists (
    select 1 from public.execution_locks
    where expires_at >= now()
      and (lock_name = 'enrichment_cycle' or lock_name like 'legacy-enrichment-admission:%')
  ) or exists (
    select 1 from public.sis_execution_runs
    where status not in ('FINALIZED','FAILED')
  ) or exists (select 1 from pgmq.q_durable_sis_v1) then
    return jsonb_build_object('status','BUSY','started',false);
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
  where observation_id = p_observation_id and status <> 'FAILED'
  order by created_at desc limit 1;
  if found then
    return jsonb_build_object('status',v_run.status,'started',false,'run_id',v_run.id);
  end if;

  insert into public.execution_locks(lock_name, holder, acquired_at, expires_at)
  values ('durable-sis-canary', p_lease_holder, now(),
          now() + make_interval(secs => p_lease_seconds));
  update public.sis_execution_controls
  set execution_enabled = true,
      execution_scope = 'DURABLE_CANARY',
      control_observation_id = p_observation_id,
      updated_at = now()
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
  select pgmq.send('durable_sis_v1', jsonb_build_object('attempt_id',v_attempt_id))
  into v_message_id;
  update public.sis_execution_attempts
  set pgmq_message_id = v_message_id where id = v_attempt_id;
  return jsonb_build_object('status','QUEUED','started',true,'run_id',v_run.id);
end
$$;

drop function if exists public.claim_durable_sis_v1_attempt(integer);

create function public.claim_durable_sis_v1_attempt(
  p_lease_holder text,
  p_visibility_seconds integer default 55
) returns table(message_id bigint, attempt_id uuid, run_id uuid, observation_id uuid,
                stage text, ordinal smallint, provider text, model text, redelivered boolean)
language plpgsql security definer
set search_path = public, pgmq, extensions
as $$
declare
  v_control public.sis_execution_controls%rowtype;
  v_msg record;
  v_attempt public.sis_execution_attempts%rowtype;
  v_run public.sis_execution_runs%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext('aiscentra.execution-admission.v1'));
  select * into v_control from public.sis_execution_controls
  where control_key = 'durable_sis_v1_control_20260825' for update;
  if not found or v_control.execution_enabled is not true or
     v_control.execution_scope <> 'DURABLE_CANARY' then return; end if;

  update public.execution_locks
  set expires_at = now() + make_interval(secs => greatest(60, least(p_visibility_seconds + 35, 120)))
  where lock_name = 'durable-sis-canary'
    and holder = p_lease_holder and expires_at >= now();
  if not found then return; end if;

  if exists (
    select 1 from pgmq.q_durable_sis_v1 queue
    left join public.sis_execution_attempts attempt
      on attempt.id = nullif(queue.message->>'attempt_id','')::uuid
    left join public.sis_execution_runs run
      on run.id = coalesce(attempt.run_id, nullif(queue.message->>'run_id','')::uuid)
    where run.id is null or run.observation_id <> v_control.control_observation_id
  ) then return; end if;

  select * into v_msg from pgmq.read('durable_sis_v1', p_visibility_seconds, 1);
  if not found then return; end if;
  if v_msg.message->>'stage' = 'FINALIZE' then
    select * into v_run from public.sis_execution_runs
    where id = (v_msg.message->>'run_id')::uuid for update;
    if not found or v_run.observation_id <> v_control.control_observation_id then return; end if;
    if v_run.status = 'FINALIZED' then
      perform pgmq.archive('durable_sis_v1', v_msg.msg_id); return;
    end if;
    if v_run.status <> 'READY_TO_FINALIZE' then
      raise exception 'durable SIS finalization run not ready';
    end if;
    return query select v_msg.msg_id, null::uuid, v_run.id, v_run.observation_id,
      'FINALIZE'::text, null::smallint, null::text, null::text, (v_msg.read_ct > 1);
    return;
  end if;

  select * into v_attempt from public.sis_execution_attempts
  where id = (v_msg.message->>'attempt_id')::uuid for update;
  if not found or v_attempt.status not in ('QUEUED','RUNNING') then
    perform pgmq.archive('durable_sis_v1', v_msg.msg_id); return;
  end if;
  select * into v_run from public.sis_execution_runs where id=v_attempt.run_id for update;
  if not found or v_run.observation_id <> v_control.control_observation_id then return; end if;
  if v_attempt.status = 'QUEUED' then
    update public.sis_execution_attempts
    set status='RUNNING', started_at=now(), pgmq_message_id=v_msg.msg_id
    where id=v_attempt.id;
  end if;
  update public.sis_execution_runs set status='RUNNING', updated_at=now()
  where id=v_attempt.run_id;
  return query select v_msg.msg_id, v_attempt.id, v_attempt.run_id, v_run.observation_id,
    v_attempt.stage, v_attempt.ordinal, v_attempt.provider, v_attempt.model,
    (v_attempt.status = 'RUNNING');
end
$$;

-- Provider completion/failure and canary stop share one lock order:
-- admission mutex first, then attempt/run/budget/queue rows. Without this,
-- completion can hold the attempt while stop holds the run and deadlock; it
-- can also enqueue a fallback after stop has begun cleanup.
create or replace function public.fail_durable_sis_v1_stage(
  p_attempt_id uuid,
  p_message_id bigint,
  p_attempt_status text,
  p_safe_diagnostic jsonb,
  p_validated_output jsonb default null
) returns jsonb
language plpgsql security definer
set search_path = public, pgmq, extensions
as $$
declare
  v_attempt public.sis_execution_attempts%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext('aiscentra.execution-admission.v1'));
  select * into v_attempt from public.sis_execution_attempts where id=p_attempt_id for update;
  if not found then raise exception 'attempt missing'; end if;
  if v_attempt.status <> 'RUNNING' then
    return jsonb_build_object('status',v_attempt.status,'duplicate',true);
  end if;
  if p_attempt_status not in ('SUCCEEDED','TERMINAL','DELIVERY_UNCERTAIN') then
    raise exception 'invalid technical failure attempt status';
  end if;
  if p_attempt_status = 'SUCCEEDED' and p_validated_output is null then
    raise exception 'successful stage output missing';
  end if;
  if p_safe_diagnostic is null or
     p_safe_diagnostic->>'type' not in (
       'json_parse','schema_validation','output_truncated','invalid_response_envelope',
       'provider_error','deadline_exceeded','budget_unavailable','delivery_uncertain'
     ) then
    raise exception 'invalid technical failure diagnostic';
  end if;
  if p_safe_diagnostic ?| array['raw_prompt','raw_response','content','reasoning'] then
    raise exception 'unsafe diagnostic keys';
  end if;

  update public.sis_execution_attempts
  set status=p_attempt_status, safe_diagnostic=p_safe_diagnostic,
      validated_output=p_validated_output, completed_at=now()
  where id=p_attempt_id;
  update public.sis_provider_budget_reservations
  set status='CONSUMED', settled_at=now()
  where attempt_id=p_attempt_id;
  update public.sis_execution_runs
  set status='FAILED', current_stage=v_attempt.stage,
      classifier_output=case
        when v_attempt.stage='CLASSIFIER' and p_attempt_status='SUCCEEDED'
          then p_validated_output
        else classifier_output
      end,
      parser_output=case
        when v_attempt.stage='PARSER' and p_attempt_status='SUCCEEDED'
          then p_validated_output
        else parser_output
      end,
      safe_last_failure=p_safe_diagnostic,
      finalization_outcome=null, finalization_signal=null,
      finalization_decision=null, finalization_message_id=null,
      updated_at=now()
  where id=v_attempt.run_id;
  perform pgmq.archive('durable_sis_v1',p_message_id);
  return jsonb_build_object('status','FAILED','stage',v_attempt.stage);
end
$$;

create or replace function public.complete_durable_sis_v1_attempt(
  p_attempt_id uuid,
  p_message_id bigint,
  p_status text,
  p_safe_diagnostic jsonb default null,
  p_validated_output jsonb default null,
  p_next_stage text default null,
  p_next_provider text default null,
  p_next_model text default null,
  p_next_units integer default null,
  p_next_unit_kind text default null,
  p_finalization_outcome text default null,
  p_finalization_signal jsonb default null,
  p_finalization_decision jsonb default null,
  p_budget_unavailable_decision jsonb default null
) returns jsonb
language plpgsql security definer
set search_path = public, pgmq, extensions
as $$
declare
  v_attempt public.sis_execution_attempts%rowtype;
  v_next_id uuid;
  v_next_ordinal smallint;
  v_next_msg bigint;
  v_final_msg bigint;
  v_budget_diagnostic jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('aiscentra.execution-admission.v1'));
  select * into v_attempt from public.sis_execution_attempts where id=p_attempt_id for update;
  if not found then raise exception 'attempt missing'; end if;
  if v_attempt.status <> 'RUNNING' then return jsonb_build_object('status',v_attempt.status,'duplicate',true); end if;
  if p_status not in ('SUCCEEDED','RETRYABLE','TERMINAL','DELIVERY_UNCERTAIN') then raise exception 'invalid status'; end if;
  if p_safe_diagnostic ?| array['raw_prompt','raw_response','content','reasoning'] then raise exception 'unsafe diagnostic keys'; end if;

  update public.sis_execution_attempts set status=p_status, safe_diagnostic=p_safe_diagnostic,
    validated_output=p_validated_output, completed_at=now() where id=p_attempt_id;
  update public.sis_provider_budget_reservations set status='CONSUMED', settled_at=now() where attempt_id=p_attempt_id;
  update public.sis_execution_runs set
    classifier_output=case when v_attempt.stage='CLASSIFIER' and p_status='SUCCEEDED' then p_validated_output else classifier_output end,
    parser_output=case when v_attempt.stage='PARSER' and p_status='SUCCEEDED' then p_validated_output else parser_output end,
    safe_last_failure=case when p_status<>'SUCCEEDED' then p_safe_diagnostic else safe_last_failure end,
    updated_at=now() where id=v_attempt.run_id;

  if p_next_stage is null then
    if p_status <> 'SUCCEEDED' then
      raise exception 'technical terminal failures must use fail_durable_sis_v1_stage';
    end if;
    if p_finalization_outcome not in ('SIGNAL','WEAK_SIGNAL','DISCARD') or
       p_finalization_signal is null or p_finalization_decision is null then
      raise exception 'durable SIS finalization payload missing';
    end if;
    select pgmq.send('durable_sis_v1',jsonb_build_object('stage','FINALIZE','run_id',v_attempt.run_id)) into v_final_msg;
    update public.sis_execution_runs set status='READY_TO_FINALIZE',current_stage='FINALIZE',
      finalization_outcome=p_finalization_outcome,finalization_signal=p_finalization_signal,
      finalization_decision=p_finalization_decision,finalization_message_id=v_final_msg,updated_at=now()
    where id=v_attempt.run_id;
    perform pgmq.archive('durable_sis_v1',p_message_id);
    return jsonb_build_object('status','QUEUED','stage','FINALIZE','message_id',v_final_msg);
  end if;
  if p_next_stage not in ('CLASSIFIER','PARSER') or p_next_provider not in ('groq','cloudflare') or nullif(p_next_model,'') is null then
    raise exception 'invalid next attempt';
  end if;
  select coalesce(max(ordinal),0)+1 into v_next_ordinal from public.sis_execution_attempts
    where run_id=v_attempt.run_id and stage=p_next_stage;
  insert into public.sis_execution_attempts(run_id,stage,ordinal,provider,model)
  values(v_attempt.run_id,p_next_stage,v_next_ordinal,p_next_provider,p_next_model) returning id into v_next_id;
  if not public.reserve_durable_sis_v1_budget(v_next_id, p_next_units, p_next_unit_kind) then
    v_budget_diagnostic := jsonb_build_object(
      'type','budget_unavailable','provider',p_next_provider,'model',p_next_model,'http_status',0,
      'finish_reason',null,'content_length',0
    );
    update public.sis_execution_attempts set status='TERMINAL',completed_at=now(),safe_diagnostic=v_budget_diagnostic
    where id=v_next_id;
    update public.sis_execution_runs set status='FAILED',current_stage=p_next_stage,
      safe_last_failure=v_budget_diagnostic,
      finalization_outcome=null,finalization_signal=null,
      finalization_decision=null,finalization_message_id=null,updated_at=now()
    where id=v_attempt.run_id;
    perform pgmq.archive('durable_sis_v1',p_message_id);
    return jsonb_build_object('status','FAILED','stage',p_next_stage,'reason','budget_unavailable');
  end if;
  select pgmq.send('durable_sis_v1',jsonb_build_object('attempt_id',v_next_id)) into v_next_msg;
  update public.sis_execution_attempts set pgmq_message_id=v_next_msg where id=v_next_id;
  update public.sis_execution_runs set status='QUEUED',current_stage=p_next_stage,updated_at=now() where id=v_attempt.run_id;
  perform pgmq.archive('durable_sis_v1',p_message_id);
  return jsonb_build_object('status','QUEUED','attempt_id',v_next_id);
end
$$;

create or replace function public.stop_durable_sis_v1_canary(
  p_lease_holder text
) returns jsonb
language plpgsql security definer
set search_path = public, pgmq, extensions
as $$
declare
  v_control public.sis_execution_controls%rowtype;
  v_run_id uuid;
  v_msg record;
  v_diagnostic jsonb := jsonb_build_object(
    'type','delivery_uncertain','provider','workflow','model','bounded-canary',
    'http_status',0,'finish_reason',null,'content_length',0
  );
begin
  perform pg_advisory_xact_lock(hashtext('aiscentra.execution-admission.v1'));
  select * into v_control from public.sis_execution_controls
  where control_key='durable_sis_v1_control_20260825' for update;
  if not found then raise exception 'durable SIS control missing'; end if;
  if v_control.execution_scope <> 'DURABLE_CANARY' then
    return jsonb_build_object('status','ALREADY_STOPPED');
  end if;
  perform 1 from public.execution_locks
  where lock_name='durable-sis-canary' and holder=p_lease_holder for update;
  if not found then return jsonb_build_object('status','HOLDER_MISMATCH'); end if;

  select id into v_run_id from public.sis_execution_runs
  where observation_id=v_control.control_observation_id
    and status not in ('FINALIZED','FAILED')
  order by created_at desc limit 1 for update;
  if found then
    update public.sis_provider_budget_reservations reservation
    set status=case when attempt.status='RUNNING' then 'CONSUMED' else 'RELEASED' end,
        settled_at=now()
    from public.sis_execution_attempts attempt
    where reservation.attempt_id=attempt.id and attempt.run_id=v_run_id
      and reservation.status='RESERVED';
    update public.sis_execution_attempts
    set status=case when status='RUNNING' then 'DELIVERY_UNCERTAIN' else 'TERMINAL' end,
        safe_diagnostic=v_diagnostic, completed_at=now()
    where run_id=v_run_id and status in ('QUEUED','RUNNING');
    for v_msg in
      select queue.msg_id
      from pgmq.q_durable_sis_v1 queue
      left join public.sis_execution_attempts attempt
        on attempt.id = nullif(queue.message->>'attempt_id','')::uuid
      where queue.message->>'run_id'=v_run_id::text or attempt.run_id=v_run_id
    loop
      perform pgmq.archive('durable_sis_v1', v_msg.msg_id);
    end loop;
    update public.sis_execution_runs
    set status='FAILED', safe_last_failure=v_diagnostic,
        finalization_outcome=null, finalization_signal=null,
        finalization_decision=null, finalization_message_id=null, updated_at=now()
    where id=v_run_id;
  end if;
  delete from public.execution_locks
  where lock_name='durable-sis-canary' and holder=p_lease_holder;
  update public.sis_execution_controls
  set execution_enabled=false, execution_scope='LEGACY', updated_at=now()
  where control_key=v_control.control_key;
  return jsonb_build_object('status','STOPPED','run_id',v_run_id);
end
$$;

revoke all on function public.acquire_legacy_enrichment_admission(text,integer)
  from public, anon, authenticated;
revoke all on function public.start_durable_sis_v1_control(uuid,text,text,integer,text,text,integer)
  from public, anon, authenticated;
revoke all on function public.claim_durable_sis_v1_attempt(text,integer)
  from public, anon, authenticated;
revoke all on function public.stop_durable_sis_v1_canary(text)
  from public, anon, authenticated;
grant execute on function public.acquire_legacy_enrichment_admission(text,integer) to service_role;
grant execute on function public.start_durable_sis_v1_control(uuid,text,text,integer,text,text,integer) to service_role;
grant execute on function public.claim_durable_sis_v1_attempt(text,integer) to service_role;
grant execute on function public.stop_durable_sis_v1_canary(text) to service_role;
