-- ============================================================
-- AIscentra — Complete Database Migration
-- Run this in: Supabase Dashboard → SQL Editor
-- ============================================================
-- Execute once on a fresh Supabase project.
-- All migrations are idempotent where possible.
-- ============================================================


-- ══════════════════════════════════════════════════════════════
-- MIGRATION 001: Extensions and Enums
-- ══════════════════════════════════════════════════════════════

create extension if not exists "uuid-ossp";
create extension if not exists "pg_trgm";

create type signal_status as enum ('CANDIDATE','DRAFT','ACTIVE','PROMOTED','EXPIRED','REJECTED');
create type signal_category as enum ('RESEARCH','MODELS','COMPANIES','INFRASTRUCTURE','OPEN_SOURCE','FUNDING','REGULATION','AGENTS','HARDWARE');
create type event_type as enum ('LAUNCH','PARTNERSHIP','RESEARCH_BREAKTHROUGH','FUNDING','ACQUISITION','INFRASTRUCTURE_CHANGE','REGULATORY_DEVELOPMENT','STRATEGIC_SHIFT');
create type report_type as enum ('SIGNAL_BRIEF','EVENT_ANALYSIS','WEEKLY_REVIEW','TREND_REPORT');
create type entity_type as enum ('COMPANY','MODEL','RESEARCH_PAPER','PERSON','PRODUCT','AGENT','ORGANIZATION','TECHNOLOGY','INFRASTRUCTURE','REGULATION','INVESTMENT','DATASET','TOOL');
create type forecast_outcome as enum ('UNRESOLVED','CONFIRMED','PARTIALLY_CONFIRMED','CONTRADICTED');
create type source_status as enum ('ACTIVE','INACTIVE','ERROR');


-- ══════════════════════════════════════════════════════════════
-- SHARED TRIGGER FUNCTION
-- ══════════════════════════════════════════════════════════════

create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- ══════════════════════════════════════════════════════════════
-- MIGRATION 002: Sources
-- ══════════════════════════════════════════════════════════════

create table public.sources (
  id                   uuid primary key default uuid_generate_v4(),
  name                 text not null,
  type                 text not null,
  url                  text not null unique,
  trust_score          numeric(3,2) not null default 0.5 check (trust_score >= 0.0 and trust_score <= 1.0),
  status               source_status not null default 'ACTIVE',
  last_checked_at      timestamptz,
  check_interval_hours integer not null default 4,
  metadata             jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index idx_sources_status on public.sources(status);
create trigger sources_updated_at before update on public.sources for each row execute function update_updated_at();
alter table public.sources enable row level security;


-- ══════════════════════════════════════════════════════════════
-- MIGRATION 003: Observations
-- ══════════════════════════════════════════════════════════════

create table public.observations (
  id               uuid primary key default uuid_generate_v4(),
  source_id        uuid not null references public.sources(id) on delete restrict,
  title            text not null,
  content          text not null,
  url              text not null,
  published_at     timestamptz not null,
  collected_at     timestamptz not null default now(),
  processed        boolean not null default false,
  processing_error text,
  signal_id        uuid,
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);

create index idx_observations_source_id    on public.observations(source_id);
create index idx_observations_processed    on public.observations(processed) where processed = false;
create index idx_observations_published_at on public.observations(published_at desc);
create index idx_observations_signal_id    on public.observations(signal_id) where signal_id is not null;
create unique index idx_observations_url   on public.observations(url);
create index idx_observations_fts          on public.observations using gin(to_tsvector('english', coalesce(title,'') || ' ' || coalesce(content,'')));
alter table public.observations enable row level security;


-- ══════════════════════════════════════════════════════════════
-- MIGRATION 004: Signals
-- ══════════════════════════════════════════════════════════════

create table public.signals (
  id           uuid primary key default uuid_generate_v4(),
  title        text not null check (char_length(title) >= 10 and char_length(title) <= 80),
  description  text not null check (char_length(description) >= 50 and char_length(description) <= 500),
  category     signal_category not null,
  status       signal_status not null default 'CANDIDATE',

  -- Raw factor scores
  impact_factor              smallint not null default 0 check (impact_factor between 0 and 10),
  actor_factor               smallint not null default 0 check (actor_factor between 0 and 10),
  novelty_factor             smallint not null default 0 check (novelty_factor between 0 and 10),
  verifiability_factor       smallint not null default 0 check (verifiability_factor between 0 and 10),
  strategic_factor           smallint not null default 0 check (strategic_factor between 0 and 10),
  authority_factor           smallint not null default 0 check (authority_factor between 0 and 10),
  corroboration_factor       smallint not null default 0 check (corroboration_factor between 0 and 10),
  specificity_factor         smallint not null default 0 check (specificity_factor between 0 and 10),
  category_confidence_factor smallint not null default 0 check (category_confidence_factor between 0 and 10),
  consistency_factor         smallint not null default 7   check (consistency_factor between 0 and 10),

  -- Computed scores
  signal_score     smallint not null default 0 check (signal_score between 0 and 100),
  confidence_score smallint not null default 0 check (confidence_score between 0 and 100),
  momentum_score   smallint not null default 0 check (momentum_score between 0 and 100),

  -- Lifecycle
  validation_flags text[]    not null default '{}',
  manual_override  boolean   not null default false,
  expiration_reason text,
  expired_at       timestamptz,

  -- Relations
  observation_ids  uuid[] not null default '{}',
  entity_ids       uuid[] not null default '{}',

  -- Momentum
  momentum_last_calculated timestamptz,

  metadata   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Back-reference from observations
alter table public.observations
  add constraint observations_signal_id_fkey
  foreign key (signal_id) references public.signals(id) on delete set null;

create index idx_signals_active_feed          on public.signals(created_at desc) where status = 'ACTIVE';
create index idx_signals_category_status      on public.signals(category, status, created_at desc);
create index idx_signals_score                on public.signals(signal_score desc) where status = 'ACTIVE';
create index idx_signals_promotion_eligible   on public.signals(signal_score desc, confidence_score desc) where status = 'ACTIVE' and signal_score >= 70 and confidence_score >= 65;
create index idx_signals_momentum_update      on public.signals(momentum_last_calculated asc nulls first) where status = 'ACTIVE';
create index idx_signals_expiration           on public.signals(category, created_at) where status = 'ACTIVE';
create index idx_signals_entity_ids           on public.signals using gin(entity_ids);
create index idx_signals_fts                  on public.signals using gin(to_tsvector('english', title || ' ' || description));

create trigger signals_updated_at before update on public.signals for each row execute function update_updated_at();
alter table public.signals enable row level security;

create policy "Public can read active signals"
  on public.signals for select to anon, authenticated
  using (status in ('ACTIVE', 'PROMOTED'));


-- ══════════════════════════════════════════════════════════════
-- MIGRATION 005: Entities
-- ══════════════════════════════════════════════════════════════

create table public.entities (
  id             uuid primary key default uuid_generate_v4(),
  name           text not null,
  canonical_name text not null unique,
  entity_type    entity_type not null,
  description    text,
  website        text,
  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index idx_entities_canonical_name on public.entities(canonical_name);
create index idx_entities_type           on public.entities(entity_type);
create index idx_entities_fts            on public.entities using gin(to_tsvector('english', name || ' ' || coalesce(description,'')));
create trigger entities_updated_at before update on public.entities for each row execute function update_updated_at();
alter table public.entities enable row level security;

create policy "Public can read entities"
  on public.entities for select to anon, authenticated using (true);

create table public.entity_relationships (
  id                uuid primary key default uuid_generate_v4(),
  source_entity_id  uuid not null references public.entities(id) on delete cascade,
  target_entity_id  uuid not null references public.entities(id) on delete cascade,
  relationship_type text not null check (relationship_type in ('produced_by','acquired_by','partnered_with','funded_by','employs','published_by','regulates','built_on','competes_with')),
  strength          numeric(3,2) not null default 1.0 check (strength >= 0.0 and strength <= 1.0),
  metadata          jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  unique (source_entity_id, target_entity_id, relationship_type)
);

create index idx_entity_rel_source on public.entity_relationships(source_entity_id);
create index idx_entity_rel_target on public.entity_relationships(target_entity_id);
create index idx_entity_rel_type   on public.entity_relationships(relationship_type);
alter table public.entity_relationships enable row level security;

create policy "Public can read entity relationships"
  on public.entity_relationships for select to anon, authenticated using (true);


-- ══════════════════════════════════════════════════════════════
-- MIGRATION 006: Events
-- ══════════════════════════════════════════════════════════════

create table public.events (
  id              uuid primary key default uuid_generate_v4(),
  signal_id       uuid not null references public.signals(id) on delete restrict,
  title           text not null,
  summary         text not null,
  impact_summary  text not null,
  forecast        text not null,
  forecast_outcome forecast_outcome not null default 'UNRESOLVED',
  impact_score    smallint not null default 0 check (impact_score between 0 and 100),
  event_type      event_type not null,
  timeline_date   date not null,
  affected_entity_ids uuid[] not null default '{}',
  manual_override boolean not null default false,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index idx_events_signal_id    on public.events(signal_id);
create index idx_events_event_type   on public.events(event_type);
create index idx_events_timeline     on public.events(timeline_date desc);
create index idx_events_impact_score on public.events(impact_score desc);
create index idx_events_entity_ids   on public.events using gin(affected_entity_ids);
create index idx_events_forecast     on public.events(forecast_outcome) where forecast_outcome = 'UNRESOLVED';
create index idx_events_fts          on public.events using gin(to_tsvector('english', title || ' ' || summary));
create trigger events_updated_at before update on public.events for each row execute function update_updated_at();
alter table public.events enable row level security;

create policy "Public can read events"
  on public.events for select to anon, authenticated using (true);


-- ══════════════════════════════════════════════════════════════
-- MIGRATION 007: Reports
-- ══════════════════════════════════════════════════════════════

create table public.reports (
  id           uuid primary key default uuid_generate_v4(),
  title        text not null,
  summary      text not null,
  content      text not null,
  report_type  report_type not null,
  signal_ids   uuid[] not null default '{}',
  event_ids    uuid[] not null default '{}',
  published_at timestamptz,
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index idx_reports_type      on public.reports(report_type);
create index idx_reports_published on public.reports(published_at desc) where published_at is not null;
create index idx_reports_signal_ids on public.reports using gin(signal_ids);
create index idx_reports_event_ids  on public.reports using gin(event_ids);
create index idx_reports_fts        on public.reports using gin(to_tsvector('english', title || ' ' || summary));
create trigger reports_updated_at before update on public.reports for each row execute function update_updated_at();
alter table public.reports enable row level security;

create policy "Public can read published reports"
  on public.reports for select to anon, authenticated
  using (published_at is not null);


-- ══════════════════════════════════════════════════════════════
-- MIGRATION 008: Knowledge Assets
-- ══════════════════════════════════════════════════════════════

create table public.knowledge_assets (
  id                  uuid primary key default uuid_generate_v4(),
  title               text not null,
  content             text not null,
  category            text not null,
  importance          smallint not null default 50 check (importance between 0 and 100),
  version             integer not null default 1,
  previous_version_id uuid references public.knowledge_assets(id) on delete set null,
  version_reason      text,
  claim_types         text[] not null default '{}' check (claim_types <@ array['FACTUAL','INTERPRETIVE','HYPOTHETICAL','FORECAST']),
  entity_ids          uuid[] not null default '{}',
  metadata            jsonb not null default '{}'::jsonb,
  updated_at          timestamptz not null default now(),
  created_at          timestamptz not null default now()
);

create index idx_knowledge_category   on public.knowledge_assets(category);
create index idx_knowledge_importance on public.knowledge_assets(importance desc);
create index idx_knowledge_entity_ids on public.knowledge_assets using gin(entity_ids);
create index idx_knowledge_version    on public.knowledge_assets(previous_version_id) where previous_version_id is not null;
create index idx_knowledge_fts        on public.knowledge_assets using gin(to_tsvector('english', title || ' ' || content));
create trigger knowledge_assets_updated_at before update on public.knowledge_assets for each row execute function update_updated_at();
alter table public.knowledge_assets enable row level security;

create policy "Public can read knowledge assets"
  on public.knowledge_assets for select to anon, authenticated using (true);


-- ══════════════════════════════════════════════════════════════
-- MIGRATION 009: Admin Users
-- ══════════════════════════════════════════════════════════════

create table public.admin_users (
  id         uuid primary key default uuid_generate_v4(),
  email      text not null unique,
  created_at timestamptz not null default now(),
  last_login timestamptz
);

alter table public.admin_users enable row level security;

create policy "Admin users can read own record"
  on public.admin_users for select to authenticated
  using (email = auth.jwt() ->> 'email');

create or replace function public.is_admin()
returns boolean language sql security definer stable as $$
  select exists (select 1 from public.admin_users where email = auth.jwt() ->> 'email');
$$;

insert into public.admin_users (email) values ('admin@aiscentra.com') on conflict (email) do nothing;


-- ══════════════════════════════════════════════════════════════
-- MIGRATION 010: Seed Sources
-- ══════════════════════════════════════════════════════════════

insert into public.sources (name, type, url, trust_score, check_interval_hours) values
  ('OpenAI Blog',       'company_blog', 'https://openai.com/blog',               0.95, 4),
  ('Anthropic News',    'company_blog', 'https://www.anthropic.com/news',        0.95, 4),
  ('Google DeepMind',   'company_blog', 'https://deepmind.google/discover/blog/',0.95, 4),
  ('Meta AI Blog',      'company_blog', 'https://ai.meta.com/blog/',             0.90, 4),
  ('Mistral AI Blog',   'company_blog', 'https://mistral.ai/news/',              0.90, 4),
  ('Hugging Face Blog', 'technical',    'https://huggingface.co/blog',           0.85, 4),
  ('GitHub Blog AI',    'technical',    'https://github.blog',                   0.80, 6),
  ('ArXiv CS.AI',       'research',     'https://arxiv.org/list/cs.AI/recent',  0.80, 8),
  ('ArXiv CS.LG',       'research',     'https://arxiv.org/list/cs.LG/recent',  0.80, 8)
on conflict (url) do nothing;


-- ══════════════════════════════════════════════════════════════
-- VERIFICATION QUERIES
-- Run these after migration to confirm everything is correct
-- ══════════════════════════════════════════════════════════════

-- Check all tables exist
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_type = 'BASE TABLE'
order by table_name;

-- Check source count (should be 9)
select count(*) as source_count from public.sources;

-- Check all enums
select typname, array_agg(enumlabel order by enumsortorder) as values
from pg_type t join pg_enum e on t.oid = e.enumtypid
where typname in ('signal_status','signal_category','event_type','report_type','entity_type','forecast_outcome','source_status')
group by typname
order by typname;

-- Check RLS is enabled on all tables
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
order by tablename;
