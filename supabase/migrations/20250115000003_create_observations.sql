-- ============================================================
-- AIscentra Migration 003
-- Observations Table
-- Reference: System Blueprint v1.0
-- Resolves: Readiness Assessment Blocker B-01
-- ============================================================

create table public.observations (
  id             uuid primary key default uuid_generate_v4(),
  source_id      uuid not null references public.sources(id) on delete restrict,
  title          text not null,

  -- Blocker B-01 Resolution: store first 3000 characters of content.
  -- This enables: deduplication, press release filter (PQ-05),
  -- signal enrichment, and source retraction handling.
  -- Full URL stored separately — content survives source going offline.
  content        text not null,   -- max 3000 chars enforced at application layer
  url            text not null,

  published_at   timestamptz not null,
  collected_at   timestamptz not null default now(),

  -- Processing state
  processed           boolean not null default false,
  processing_error    text,
  signal_id           uuid,        -- set when observation becomes a signal (FK added in migration 004)

  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

-- Indexes for pipeline queries
create index idx_observations_source_id    on public.observations(source_id);
create index idx_observations_processed    on public.observations(processed) where processed = false;
create index idx_observations_published_at on public.observations(published_at desc);
create index idx_observations_signal_id    on public.observations(signal_id) where signal_id is not null;

-- Unique on URL — prevents duplicate collection of same article
create unique index idx_observations_url on public.observations(url);

-- Full-text search on title + content (used by deduplication PQ-06)
create index idx_observations_fts on public.observations
  using gin(to_tsvector('english', coalesce(title, '') || ' ' || coalesce(content, '')));

-- ── RLS ──────────────────────────────────────────────────────
alter table public.observations enable row level security;

-- Observations are internal — no public access
-- Admin/pipeline access via service role only

comment on table public.observations is
  'Raw collected ecosystem data. content stores first 3000 characters. '
  'Resolves Readiness Assessment Blocker B-01 (content storage strategy). '
  'Reference: System Blueprint v1.0, Signal Scoring Specification v1.0 Section 03';

comment on column public.observations.content is
  'First 3000 characters of source content. '
  'Ensures signals remain verifiable even if source URL goes offline. '
  'Sufficient for PQ-05 press release filter and signal enrichment.';
