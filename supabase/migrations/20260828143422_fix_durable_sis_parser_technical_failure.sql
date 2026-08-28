-- Durable SIS parser technical-failure repair.
-- Schema-only deployment: the control stays disabled and this migration does
-- not recover historical rows automatically.

create table public.sis_execution_recoveries (
  run_id uuid primary key references public.sis_execution_runs(id),
  observation_id uuid not null references public.observations(id),
  decision_log_id uuid not null unique references public.signal_decision_log(id),
  reason text not null check (reason = 'TECHNICAL_PROVIDER_CHAIN_FAILURE'),
  recovered_at timestamptz not null default now()
);

alter table public.sis_execution_recoveries enable row level security;
revoke all on public.sis_execution_recoveries from public, anon, authenticated;
grant all on public.sis_execution_recoveries to service_role;

alter table public.sis_execution_runs
  drop constraint if exists sis_execution_runs_control_key_observation_id_key;

create unique index sis_execution_runs_one_nonfailed_per_observation_idx
  on public.sis_execution_runs(control_key, observation_id)
  where status <> 'FAILED';

create or replace function public.start_durable_sis_v1_control(
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
  select * into v_control from public.sis_execution_controls
  where control_key = 'durable_sis_v1_control_20260825' for update;

  if not found then raise exception 'durable SIS control missing'; end if;
  if not v_control.execution_enabled then
    update public.sis_execution_runs set status = 'PAUSED', updated_at = now()
    where control_key = v_control.control_key and status not in ('FINALIZED','FAILED');
    return jsonb_build_object('status','PAUSED','started',false);
  end if;

  if p_provider not in ('groq','cloudflare') or nullif(p_model,'') is null then
    raise exception 'invalid initial provider/model';
  end if;

  if not exists (
    select 1 from public.observations o
    where o.id = v_control.control_observation_id
      and o.processed is false and o.signal_id is null
      and not exists (
        select 1 from public.signal_decision_log d
        where d.observation_id = o.id
          and not exists (
            select 1 from public.sis_execution_recoveries recovery
            where recovery.decision_log_id = d.id
          )
      )
  ) then
    return jsonb_build_object('status','INELIGIBLE','started',false);
  end if;

  select * into v_run from public.sis_execution_runs
  where control_key = v_control.control_key
    and observation_id = v_control.control_observation_id
    and status <> 'FAILED'
  order by created_at desc
  limit 1;
  if found then
    return jsonb_build_object('status',v_run.status,'started',false,'run_id',v_run.id);
  end if;

  insert into public.sis_execution_runs(control_key, observation_id, status)
  values (v_control.control_key, v_control.control_observation_id, 'QUEUED')
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

create or replace function public.finalize_durable_sis_v1(
  p_run_id uuid, p_message_id bigint
) returns jsonb
language plpgsql security definer
set search_path = public, pgmq, extensions
as $$
declare
  v_run public.sis_execution_runs%rowtype;
  v_existing public.sis_execution_finalizations%rowtype;
  v_signal_id uuid;
  v_decision_id uuid;
begin
  select * into v_run from public.sis_execution_runs where id=p_run_id for update;
  if not found then raise exception 'run missing'; end if;
  select * into v_existing from public.sis_execution_finalizations where run_id=p_run_id;
  if found then
    perform pgmq.archive('durable_sis_v1',p_message_id);
    return jsonb_build_object('outcome',v_existing.outcome,'signal_id',v_existing.signal_id,'decision_log_id',v_existing.decision_log_id,'duplicate',true);
  end if;
  if v_run.status<>'READY_TO_FINALIZE' then raise exception 'run not ready'; end if;
  if v_run.finalization_outcome is null or v_run.finalization_signal is null or v_run.finalization_decision is null then
    raise exception 'finalization payload missing';
  end if;
  perform 1 from public.observations where id=v_run.observation_id for update;
  if exists(select 1 from public.signals where v_run.observation_id=any(observation_ids)) or
     exists(
       select 1 from public.signal_decision_log d
       where d.observation_id=v_run.observation_id
         and not exists (
           select 1 from public.sis_execution_recoveries recovery
           where recovery.decision_log_id=d.id
         )
     ) then
    raise exception 'observation already finalized';
  end if;
  if v_run.finalization_outcome in ('SIGNAL','WEAK_SIGNAL') then
    insert into public.signals(title,description,category,status,impact_factor,actor_factor,novelty_factor,
      verifiability_factor,strategic_factor,authority_factor,corroboration_factor,specificity_factor,
      category_confidence_factor,consistency_factor,signal_score,confidence_score,momentum_score,
      intelligence_type,quality_state,quality_reason_codes,quality_rule_version,observation_ids,
      sis_novelty,sis_importance,sis_urgency,sis_confidence,sis_final,qualification_score,
      human_relevance_flags,anti_hype_score,anti_hype_flags,relevance_horizon,lifecycle_state,
      engine_version,has_verified_source,metadata)
    values(v_run.finalization_signal->>'title',v_run.finalization_signal->>'description',(v_run.finalization_signal->>'category')::public.signal_category,
      case when v_run.finalization_outcome='WEAK_SIGNAL' then 'WEAK' else 'DRAFT' end::public.signal_status,
      (v_run.finalization_signal->>'impact_factor')::smallint,(v_run.finalization_signal->>'actor_factor')::smallint,(v_run.finalization_signal->>'novelty_factor')::smallint,
      (v_run.finalization_signal->>'verifiability_factor')::smallint,(v_run.finalization_signal->>'strategic_factor')::smallint,
      (v_run.finalization_signal->>'authority_factor')::smallint,(v_run.finalization_signal->>'corroboration_factor')::smallint,
      (v_run.finalization_signal->>'specificity_factor')::smallint,(v_run.finalization_signal->>'category_confidence_factor')::smallint,7,
      (v_run.finalization_signal->>'signal_score')::smallint,(v_run.finalization_signal->>'confidence_score')::smallint,
      coalesce((v_run.finalization_signal->>'momentum_score')::smallint,0),v_run.finalization_outcome,'PENDING',array['AWAITING_QUALITY_REVIEW'],
      'quality-foundation-v1',array[v_run.observation_id],(v_run.finalization_decision->>'sis_novelty')::numeric,
      (v_run.finalization_decision->>'sis_importance')::numeric,(v_run.finalization_decision->>'sis_urgency')::numeric,
      (v_run.finalization_decision->>'sis_confidence')::numeric,(v_run.finalization_decision->>'sis_final')::numeric,
      (v_run.finalization_decision->>'sis_final')::numeric,coalesce(v_run.finalization_decision->'human_relevance','{}'::jsonb),
      (v_run.finalization_decision->>'anti_hype_score')::numeric,coalesce(v_run.finalization_decision->'anti_hype_flags','{}'::jsonb),
      v_run.finalization_decision->>'relevance_horizon','ACTIVE','durable-sis-v1',false,
      jsonb_build_object('durable_sis_run_id',p_run_id)) returning id into v_signal_id;
  elsif v_run.finalization_outcome <> 'DISCARD' then raise exception 'invalid outcome'; end if;
  insert into public.signal_decision_log(signal_id,observation_id,decision,rejection_code,rejection_reason,
    engine_justification,qualification_score,sis_novelty,sis_importance,sis_urgency,sis_confidence,sis_final,
    human_relevance_breakdown,anti_hype_score,anti_hype_flags,engine_version)
  values(v_signal_id,v_run.observation_id,v_run.finalization_outcome,v_run.finalization_decision->>'rejection_code',v_run.finalization_decision->>'rejection_reason',
    v_run.finalization_decision->>'engine_justification',(v_run.finalization_decision->>'sis_final')::numeric,(v_run.finalization_decision->>'sis_novelty')::numeric,
    (v_run.finalization_decision->>'sis_importance')::numeric,(v_run.finalization_decision->>'sis_urgency')::numeric,
    (v_run.finalization_decision->>'sis_confidence')::numeric,(v_run.finalization_decision->>'sis_final')::numeric,
    coalesce(v_run.finalization_decision->'human_relevance','{}'::jsonb),(v_run.finalization_decision->>'anti_hype_score')::numeric,
    coalesce(v_run.finalization_decision->'anti_hype_flags','{}'::jsonb),'durable-sis-v1') returning id into v_decision_id;
  update public.observations set processed=true,signal_id=v_signal_id,processing_error=null,
    qualification_result=v_run.finalization_outcome,rejection_code=v_run.finalization_decision->>'rejection_code',
    rejection_reason=v_run.finalization_decision->>'rejection_reason',engine_version='durable-sis-v1'
  where id=v_run.observation_id;
  insert into public.sis_execution_finalizations(run_id,observation_id,outcome,signal_id,decision_log_id)
  values(p_run_id,v_run.observation_id,v_run.finalization_outcome,v_signal_id,v_decision_id);
  perform pgmq.archive('durable_sis_v1',p_message_id);
  update public.sis_execution_runs set status='FINALIZED',updated_at=now() where id=p_run_id;
  return jsonb_build_object('outcome',v_run.finalization_outcome,'signal_id',v_signal_id,'decision_log_id',v_decision_id,'duplicate',false);
end
$$;

create or replace function public.recover_durable_sis_v1_technical_failure(
  p_run_id uuid,
  p_expected_decision_id uuid
) returns jsonb
language plpgsql security definer
set search_path = public, pgmq, extensions
as $$
declare
  v_run public.sis_execution_runs%rowtype;
  v_finalization public.sis_execution_finalizations%rowtype;
  v_decision public.signal_decision_log%rowtype;
  v_control_enabled boolean;
begin
  select execution_enabled into v_control_enabled from public.sis_execution_controls
  where control_key='durable_sis_v1_control_20260825' for update;
  if coalesce(v_control_enabled,true) then raise exception 'durable SIS control must be disabled'; end if;

  select * into v_run from public.sis_execution_runs where id=p_run_id for update;
  if not found or v_run.status<>'FINALIZED' or v_run.finalization_outcome<>'DISCARD' then
    raise exception 'run is not a finalized discard';
  end if;
  select * into v_finalization from public.sis_execution_finalizations where run_id=p_run_id for update;
  if not found or v_finalization.observation_id<>v_run.observation_id or
     v_finalization.decision_log_id<>p_expected_decision_id or v_finalization.signal_id is not null then
    raise exception 'finalization does not match expected technical discard';
  end if;
  select * into v_decision from public.signal_decision_log where id=p_expected_decision_id;
  if not found or v_decision.observation_id<>v_run.observation_id or
     v_decision.signal_id is not null or v_decision.decision<>'DISCARD' or
     v_decision.rejection_code<>'R-15' or
     coalesce(v_decision.rejection_reason,'') !~ '^Durable SIS (classifier|parser) exhausted provider chain$' or
     coalesce(v_decision.engine_justification,'')<>'All bounded provider attempts ended in typed failures.' then
    raise exception 'decision is not the known technical provider-chain discard';
  end if;
  if coalesce(v_run.safe_last_failure->>'type','') not in (
    'json_parse','schema_validation','output_truncated','invalid_response_envelope',
    'provider_error','deadline_exceeded','budget_unavailable','delivery_uncertain'
  ) then
    raise exception 'run has no typed technical failure';
  end if;
  if exists(select 1 from public.signals where v_run.observation_id=any(observation_ids)) or
     exists(select 1 from public.observations where id=v_run.observation_id and signal_id is not null) then
    raise exception 'observation already has a signal';
  end if;
  if exists(select 1 from public.sis_execution_attempts where run_id=p_run_id and status in ('QUEUED','RUNNING')) or
     exists(select 1 from public.sis_provider_budget_reservations reservation
       join public.sis_execution_attempts attempt on attempt.id=reservation.attempt_id
       where attempt.run_id=p_run_id and reservation.status='RESERVED') or
     exists(select 1 from pgmq.q_durable_sis_v1 where message->>'run_id'=p_run_id::text or
       message->>'attempt_id' in (select id::text from public.sis_execution_attempts where run_id=p_run_id)) then
    raise exception 'run still has active operational work';
  end if;

  insert into public.sis_execution_recoveries(run_id,observation_id,decision_log_id,reason)
  values(p_run_id,v_run.observation_id,p_expected_decision_id,'TECHNICAL_PROVIDER_CHAIN_FAILURE');
  delete from public.sis_execution_finalizations where run_id=p_run_id;
  update public.sis_execution_runs
  set status='FAILED', current_stage=case
        when v_decision.rejection_reason like 'Durable SIS classifier %' then 'CLASSIFIER'
        else 'PARSER'
      end,
      finalization_outcome=null,
      finalization_signal=null, finalization_decision=null,
      finalization_message_id=null, updated_at=now()
  where id=p_run_id;
  update public.observations
  set processed=false, signal_id=null, processing_error=null,
      qualification_result=null, rejection_code=null, rejection_reason=null,
      engine_version=null
  where id=v_run.observation_id
    and processed=true and signal_id is null
    and qualification_result='DISCARD' and rejection_code='R-15'
    and rejection_reason=v_decision.rejection_reason;
  if not found then raise exception 'observation state does not match technical discard'; end if;

  return jsonb_build_object(
    'status','RECOVERED','run_id',p_run_id,'observation_id',v_run.observation_id,
    'decision_log_id',p_expected_decision_id
  );
end
$$;

revoke all on function public.fail_durable_sis_v1_stage(uuid,bigint,text,jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.recover_durable_sis_v1_technical_failure(uuid,uuid) from public, anon, authenticated;
grant execute on function public.fail_durable_sis_v1_stage(uuid,bigint,text,jsonb,jsonb) to service_role;
grant execute on function public.recover_durable_sis_v1_technical_failure(uuid,uuid) to service_role;
