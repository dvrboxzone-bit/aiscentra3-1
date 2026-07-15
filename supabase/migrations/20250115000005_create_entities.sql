-- ============================================================
-- AIscentra Migration 005
-- Entities and Entity Relationships
-- Reference: System Blueprint v1.0, Intelligence Systems Analyst Skill v1.0
-- ============================================================

-- ── Entities ─────────────────────────────────────────────────
create table public.entities (
  id             uuid primary key default uuid_generate_v4(),
  name           text not null,

  -- canonical_name: normalized for deduplication
  -- Intelligence Systems Analyst Skill v1.0, Section 05.2:
  -- "OpenAI", "Open AI", "openai.com", "OpenAI Inc." → same canonical
  -- Normalization: lowercase, strip punctuation, trim whitespace
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

-- Full-text search on entity name
create index idx_entities_fts
  on public.entities
  using gin(to_tsvector('english', name || ' ' || coalesce(description, '')));

create trigger entities_updated_at
  before update on public.entities
  for each row execute function update_updated_at();

-- ── RLS ──────────────────────────────────────────────────────
alter table public.entities enable row level security;

-- Entities are public — users can look up any entity
create policy "Public can read entities"
  on public.entities
  for select
  to anon, authenticated
  using (true);

-- ── Entity Relationships ──────────────────────────────────────
-- Intelligence Systems Analyst Skill v1.0, Section 05.3
-- Approved relationship types for MVP:
-- produced_by | acquired_by | partnered_with | funded_by |
-- employs | published_by | regulates | built_on | competes_with
create table public.entity_relationships (
  id                uuid primary key default uuid_generate_v4(),
  source_entity_id  uuid not null references public.entities(id) on delete cascade,
  target_entity_id  uuid not null references public.entities(id) on delete cascade,

  -- Relationship type — constrained to approved types
  relationship_type text not null
    check (relationship_type in (
      'produced_by',
      'acquired_by',
      'partnered_with',
      'funded_by',
      'employs',
      'published_by',
      'regulates',
      'built_on',
      'competes_with'
    )),

  -- strength: 0.0–1.0 confidence in this relationship
  strength   numeric(3,2) not null default 1.0
             check (strength >= 0.0 and strength <= 1.0),

  metadata   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),

  -- Prevent duplicate relationships
  unique (source_entity_id, target_entity_id, relationship_type)
);

create index idx_entity_rel_source on public.entity_relationships(source_entity_id);
create index idx_entity_rel_target on public.entity_relationships(target_entity_id);
create index idx_entity_rel_type   on public.entity_relationships(relationship_type);

-- ── RLS ──────────────────────────────────────────────────────
alter table public.entity_relationships enable row level security;

create policy "Public can read entity relationships"
  on public.entity_relationships
  for select
  to anon, authenticated
  using (true);

comment on table public.entities is
  'Ecosystem entity registry. canonical_name enables deduplication. '
  'Intelligence Systems Analyst Skill v1.0, Section 05.2.';

comment on table public.entity_relationships is
  'Entity relationship graph. relationship_type constrained to 9 approved types. '
  'Intelligence Systems Analyst Skill v1.0, Section 05.3.';
