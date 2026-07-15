-- ============================================================
-- AIscentra Migration 008
-- Knowledge Assets Table
-- Reference: Intelligence Evolution Framework v1.0
-- ============================================================

create table public.knowledge_assets (
  id          uuid primary key default uuid_generate_v4(),
  title       text not null,
  content     text not null,
  category    text not null,  -- 'entity_profile' | 'topic_summary' | 'timeline' | 'relationship_map' | 'trend_summary'
  importance  smallint not null default 50 check (importance between 0 and 100),

  -- Version control — Intelligence Evolution Framework v1.0, Section 10.2
  -- "Every update to a knowledge asset creates a new version"
  -- "The reason for each version update is recorded"
  version              integer not null default 1,
  previous_version_id  uuid references public.knowledge_assets(id) on delete set null,
  version_reason       text,  -- Why was this version created?

  -- Epistemic classification — IEF v1.0, Section 11
  -- Which claim types does this asset contain?
  claim_types text[] not null default '{}'
    check (claim_types <@ array['FACTUAL','INTERPRETIVE','HYPOTHETICAL','FORECAST']),

  entity_ids  uuid[] not null default '{}',
  metadata    jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

create index idx_knowledge_category    on public.knowledge_assets(category);
create index idx_knowledge_importance  on public.knowledge_assets(importance desc);
create index idx_knowledge_entity_ids  on public.knowledge_assets using gin(entity_ids);
create index idx_knowledge_version     on public.knowledge_assets(previous_version_id) where previous_version_id is not null;

create index idx_knowledge_fts
  on public.knowledge_assets
  using gin(to_tsvector('english', title || ' ' || content));

create trigger knowledge_assets_updated_at
  before update on public.knowledge_assets
  for each row execute function update_updated_at();

-- ── RLS ──────────────────────────────────────────────────────
alter table public.knowledge_assets enable row level security;

create policy "Public can read knowledge assets"
  on public.knowledge_assets
  for select
  to anon, authenticated
  using (true);

comment on table public.knowledge_assets is
  'Long-term structured knowledge. Version-controlled per IEF v1.0 Section 10. '
  'Every update creates version N+1, preserving version N. '
  'Primary input for the Observatory Assistant and Scenario Intelligence Agent.';
