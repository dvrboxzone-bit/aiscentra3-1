-- ============================================================
-- AIscentra Migration 006
-- Events Table
-- Reference: System Blueprint v1.0, Intelligence Systems Analyst Skill v1.0
-- ============================================================

create table public.events (
  id         uuid primary key default uuid_generate_v4(),

  -- signal_id is non-nullable: orphan events are forbidden
  -- Intelligence Systems Analyst Skill v1.0, Section 04.3: "signal_id: required, non-nullable"
  signal_id  uuid not null references public.signals(id) on delete restrict,

  title      text not null,
  summary    text not null,

  -- impact_summary: 2–3 sentences. What changed and for whom. No speculation.
  impact_summary  text not null,

  -- forecast: 1–2 sentences. Prefixed "Expected:" or "Watch for:" per ISA Skill Section 04.3
  forecast        text not null,
  forecast_outcome forecast_outcome not null default 'UNRESOLVED',

  -- impact_score: breadth of ecosystem impact (NOT the same as signal_score)
  -- ISA Skill Section 04.4: "measures how many entities or sectors are affected"
  impact_score    smallint not null default 0 check (impact_score between 0 and 100),

  event_type      event_type not null,

  -- timeline_date: when the development OCCURRED, not when the event was created
  -- Intelligence Evolution Framework v1.0: preserves historical accuracy
  timeline_date   date not null,

  affected_entity_ids uuid[] not null default '{}',
  manual_override     boolean not null default false,
  metadata            jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indexes
create index idx_events_signal_id    on public.events(signal_id);
create index idx_events_event_type   on public.events(event_type);
create index idx_events_timeline     on public.events(timeline_date desc);
create index idx_events_impact_score on public.events(impact_score desc);
create index idx_events_entity_ids   on public.events using gin(affected_entity_ids);
create index idx_events_forecast     on public.events(forecast_outcome) where forecast_outcome = 'UNRESOLVED';

-- Full-text search
create index idx_events_fts
  on public.events
  using gin(to_tsvector('english', title || ' ' || summary));

create trigger events_updated_at
  before update on public.events
  for each row execute function update_updated_at();

-- ── RLS ──────────────────────────────────────────────────────
alter table public.events enable row level security;

create policy "Public can read events"
  on public.events
  for select
  to anon, authenticated
  using (true);

comment on table public.events is
  'Promoted signals enriched with impact analysis and forecast. '
  'signal_id is non-nullable — no orphan events permitted. '
  'forecast_outcome tracked per Intelligence Evolution Framework v1.0 Section 04.';
