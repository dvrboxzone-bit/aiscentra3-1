-- ============================================================
-- AIscentra Migration 002
-- Sources Table
-- Reference: System Blueprint v1.0, Signal Scoring Specification v1.0 PQ-01
-- ============================================================

create table public.sources (
  id           uuid primary key default uuid_generate_v4(),
  name         text not null,
  type         text not null,                    -- 'blog', 'arxiv', 'github', 'reddit', etc.
  url          text not null unique,
  -- trust_score: 0.0–1.0
  -- PQ-01: observations from sources with trust_score < 0.5 are rejected
  trust_score  numeric(3,2) not null default 0.5
               check (trust_score >= 0.0 and trust_score <= 1.0),
  status       source_status not null default 'ACTIVE',
  -- Collection metadata
  last_checked_at  timestamptz,
  check_interval_hours integer not null default 4,
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Index for active source queries (collection pipeline)
create index idx_sources_status on public.sources(status);

-- Auto-update updated_at
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger sources_updated_at
  before update on public.sources
  for each row execute function update_updated_at();

-- ── RLS ──────────────────────────────────────────────────────
alter table public.sources enable row level security;

-- Public: no read access to sources (internal system table)
-- Admin: full access via service role (bypasses RLS)

comment on table public.sources is
  'External source registry for the Observation Layer. '
  'trust_score governs PQ-01 pre-qualification filter. '
  'Reference: Signal Scoring Specification v1.0, Section 03.2';
