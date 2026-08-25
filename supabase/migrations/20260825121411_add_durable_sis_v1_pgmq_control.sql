-- Durable SIS Execution V1: one-ID PGMQ control.
-- Additive only. The control is installed disabled and is never scheduled.

create extension if not exists pgmq;

do $$
begin
  if not exists (
    select 1 from pgmq.meta where queue_name = 'durable_sis_v1'
  ) then
    perform pgmq.create('durable_sis_v1');
  end if;
end
$$;

create table public.sis_execution_controls (
  control_key text primary key,
  execution_enabled boolean not null default false,
  control_observation_id uuid not null,
  groq_daily_token_limit integer not null default 30000 check (groq_daily_token_limit > 0),
  cloudflare_daily_request_limit integer not null default 20 check (cloudflare_daily_request_limit > 0),
  max_attempts_per_stage integer not null default 3 check (max_attempts_per_stage between 1 and 3),
  updated_at timestamptz not null default now(),
  check (control_key = 'durable_sis_v1_control_20260825'),
  check (control_observation_id = 'e4275483-39e4-4441-84a2-0a1df546cf07'::uuid)
);

insert into public.sis_execution_controls(control_key, control_observation_id, execution_enabled)
values ('durable_sis_v1_control_20260825', 'e4275483-39e4-4441-84a2-0a1df546cf07', false)
on conflict (control_key) do nothing;

create table public.sis_execution_runs (
  id uuid primary key default gen_random_uuid(),
  control_key text not null references public.sis_execution_controls(control_key),
  observation_id uuid not null references public.observations(id),
  status text not null default 'PAUSED' check (status in ('PAUSED','QUEUED','RUNNING','READY_TO_FINALIZE','FINALIZED','FAILED')),
  current_stage text not null default 'CLASSIFIER' check (current_stage in ('CLASSIFIER','PARSER','FINALIZE')),
  classifier_output jsonb,
  parser_output jsonb,
  safe_last_failure jsonb,
  finalization_outcome text check (finalization_outcome in ('SIGNAL','WEAK_SIGNAL','DISCARD')),
  finalization_signal jsonb,
  finalization_decision jsonb,
  finalization_message_id bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(control_key, observation_id),
  check (observation_id = 'e4275483-39e4-4441-84a2-0a1df546cf07'::uuid),
  check (
    (finalization_outcome is null and finalization_signal is null and finalization_decision is null) or
    (finalization_outcome is not null and finalization_signal is not null and finalization_decision is not null)
  )
);

create table public.sis_execution_attempts (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.sis_execution_runs(id),
  stage text not null check (stage in ('CLASSIFIER','PARSER')),
  ordinal smallint not null check (ordinal between 1 and 3),
  provider text not null check (provider in ('groq','cloudflare')),
  model text not null,
  status text not null default 'QUEUED' check (status in ('QUEUED','RUNNING','SUCCEEDED','RETRYABLE','TERMINAL','DELIVERY_UNCERTAIN')),
  pgmq_message_id bigint,
  safe_diagnostic jsonb,
  validated_output jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(run_id, stage, ordinal)
);

create table public.sis_provider_budget_reservations (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null unique references public.sis_execution_attempts(id),
  provider text not null check (provider in ('groq','cloudflare')),
  model text not null,
  unit_kind text not null check (
    (provider = 'groq' and unit_kind = 'groq_tokens') or
    (provider = 'cloudflare' and unit_kind = 'provider_request')
  ),
  reserved_units integer not null check (reserved_units > 0),
  status text not null default 'RESERVED' check (status in ('RESERVED','CONSUMED','RELEASED')),
  reserved_at timestamptz not null default now(),
  settled_at timestamptz
);

create table public.sis_execution_finalizations (
  run_id uuid primary key references public.sis_execution_runs(id),
  observation_id uuid not null unique references public.observations(id),
  outcome text not null check (outcome in ('SIGNAL','WEAK_SIGNAL','DISCARD')),
  signal_id uuid references public.signals(id),
  decision_log_id uuid not null references public.signal_decision_log(id),
  finalized_at timestamptz not null default now()
);

alter table public.sis_execution_controls enable row level security;
alter table public.sis_execution_runs enable row level security;
alter table public.sis_execution_attempts enable row level security;
alter table public.sis_provider_budget_reservations enable row level security;
alter table public.sis_execution_finalizations enable row level security;

revoke all on public.sis_execution_controls, public.sis_execution_runs,
  public.sis_execution_attempts, public.sis_provider_budget_reservations,
  public.sis_execution_finalizations from public, anon, authenticated;
grant all on public.sis_execution_controls, public.sis_execution_runs,
  public.sis_execution_attempts, public.sis_provider_budget_reservations,
  public.sis_execution_finalizations to service_role;

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
      and not exists (select 1 from public.signal_decision_log d where d.observation_id = o.id)
  ) then
    return jsonb_build_object('status','INELIGIBLE','started',false);
  end if;

  insert into public.sis_execution_runs(control_key, observation_id, status)
  values (v_control.control_key, v_control.control_observation_id, 'QUEUED')
  on conflict (control_key, observation_id) do update set updated_at = now()
  returning * into v_run;

  if exists (select 1 from public.sis_execution_attempts where run_id = v_run.id) then
    return jsonb_build_object('status',v_run.status,'started',false,'run_id',v_run.id);
  end if;

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

create or replace function public.claim_durable_sis_v1_attempt(p_visibility_seconds integer default 55)
returns table(message_id bigint, attempt_id uuid, run_id uuid, observation_id uuid, stage text, ordinal smallint, provider text, model text, redelivered boolean)
language plpgsql security definer
set search_path = public, pgmq, extensions
as $$
declare
  v_enabled boolean;
  v_msg record;
  v_attempt public.sis_execution_attempts%rowtype;
  v_run public.sis_execution_runs%rowtype;
begin
  select execution_enabled into v_enabled from public.sis_execution_controls
  where control_key = 'durable_sis_v1_control_20260825' for update;
  if coalesce(v_enabled, false) is false then
    update public.sis_execution_runs set status='PAUSED', updated_at=now()
    where control_key='durable_sis_v1_control_20260825' and status not in ('FINALIZED','FAILED');
    return;
  end if;

  select * into v_msg from pgmq.read('durable_sis_v1', p_visibility_seconds, 1);
  if not found then return; end if;

  if v_msg.message->>'stage' = 'FINALIZE' then
    select * into v_run from public.sis_execution_runs
    where id = (v_msg.message->>'run_id')::uuid for update;
    if not found or v_run.status = 'FINALIZED' then
      perform pgmq.archive('durable_sis_v1', v_msg.msg_id);
      return;
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
    perform pgmq.archive('durable_sis_v1', v_msg.msg_id);
    return;
  end if;

  if v_attempt.status = 'QUEUED' then
    update public.sis_execution_attempts
    set status='RUNNING', started_at=now(), pgmq_message_id=v_msg.msg_id
    where id=v_attempt.id;
  end if;
  update public.sis_execution_runs set status='RUNNING', updated_at=now() where id=v_attempt.run_id;

  return query select v_msg.msg_id, v_attempt.id, v_attempt.run_id, r.observation_id,
    v_attempt.stage, v_attempt.ordinal, v_attempt.provider, v_attempt.model,
    (v_attempt.status = 'RUNNING')
  from public.sis_execution_runs r where r.id=v_attempt.run_id;
end
$$;

create or replace function public.reserve_durable_sis_v1_budget(
  p_attempt_id uuid, p_units integer, p_unit_kind text
) returns boolean
language plpgsql security definer
set search_path = public, extensions
as $$
declare v_attempt public.sis_execution_attempts%rowtype; v_limit integer; v_used bigint;
begin
  select * into v_attempt from public.sis_execution_attempts where id=p_attempt_id and status in ('QUEUED','RUNNING') for update;
  if not found or p_units <= 0 then return false; end if;
  if (v_attempt.provider='groq' and p_unit_kind<>'groq_tokens') or
     (v_attempt.provider='cloudflare' and p_unit_kind<>'provider_request') then return false; end if;
  select case when v_attempt.provider='groq' then groq_daily_token_limit else cloudflare_daily_request_limit end
    into v_limit from public.sis_execution_controls where control_key='durable_sis_v1_control_20260825' for update;
  select coalesce(sum(reserved_units),0) into v_used from public.sis_provider_budget_reservations
  where provider=v_attempt.provider and reserved_at >= date_trunc('day',now()) and status in ('RESERVED','CONSUMED');
  if v_used + p_units > v_limit then return false; end if;
  insert into public.sis_provider_budget_reservations(attempt_id,provider,model,unit_kind,reserved_units)
  values(p_attempt_id,v_attempt.provider,v_attempt.model,p_unit_kind,p_units) on conflict(attempt_id) do nothing;
  return found;
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
    if p_budget_unavailable_decision is null then
      raise exception 'durable SIS budget-unavailable finalization decision missing';
    end if;
    update public.sis_execution_attempts set status='TERMINAL',completed_at=now(),safe_diagnostic=jsonb_build_object(
      'type','budget_unavailable','provider',p_next_provider,'model',p_next_model,'http_status',0,
      'finish_reason',null,'content_length',0
    ) where id=v_next_id;
    select pgmq.send('durable_sis_v1',jsonb_build_object('stage','FINALIZE','run_id',v_attempt.run_id)) into v_final_msg;
    update public.sis_execution_runs set status='READY_TO_FINALIZE',current_stage='FINALIZE',
      safe_last_failure=(select safe_diagnostic from public.sis_execution_attempts where id=v_next_id),
      finalization_outcome='DISCARD',finalization_signal='{}'::jsonb,
      finalization_decision=p_budget_unavailable_decision,finalization_message_id=v_final_msg,updated_at=now()
    where id=v_attempt.run_id;
    perform pgmq.archive('durable_sis_v1',p_message_id);
    return jsonb_build_object('status','QUEUED','stage','FINALIZE','reason','budget_unavailable','message_id',v_final_msg);
  end if;
  select pgmq.send('durable_sis_v1',jsonb_build_object('attempt_id',v_next_id)) into v_next_msg;
  update public.sis_execution_attempts set pgmq_message_id=v_next_msg where id=v_next_id;
  update public.sis_execution_runs set status='QUEUED',current_stage=p_next_stage,updated_at=now() where id=v_attempt.run_id;
  perform pgmq.archive('durable_sis_v1',p_message_id);
  return jsonb_build_object('status','QUEUED','attempt_id',v_next_id);
end
$$;

-- The only path allowed to create the final Signal/rejection. Row locks and the
-- finalization primary key make repeated calls return the existing result.
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
     exists(select 1 from public.signal_decision_log where observation_id=v_run.observation_id) then
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

revoke all on function public.start_durable_sis_v1_control(text,text,integer,text) from public, anon, authenticated;
revoke all on function public.claim_durable_sis_v1_attempt(integer) from public, anon, authenticated;
revoke all on function public.reserve_durable_sis_v1_budget(uuid,integer,text) from public, anon, authenticated;
revoke all on function public.complete_durable_sis_v1_attempt(uuid,bigint,text,jsonb,jsonb,text,text,text,integer,text,text,jsonb,jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.finalize_durable_sis_v1(uuid,bigint) from public, anon, authenticated;
grant execute on function public.start_durable_sis_v1_control(text,text,integer,text) to service_role;
grant execute on function public.claim_durable_sis_v1_attempt(integer) to service_role;
grant execute on function public.reserve_durable_sis_v1_budget(uuid,integer,text) to service_role;
grant execute on function public.complete_durable_sis_v1_attempt(uuid,bigint,text,jsonb,jsonb,text,text,text,integer,text,text,jsonb,jsonb,jsonb) to service_role;
grant execute on function public.finalize_durable_sis_v1(uuid,bigint) to service_role;
