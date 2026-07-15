-- ============================================================
-- AIscentra Migration 007
-- Reports Table
-- Reference: System Blueprint v1.0, MVP Specification v1.0
-- ============================================================

create table public.reports (
  id          uuid primary key default uuid_generate_v4(),
  title       text not null,
  summary     text not null,  -- 2–3 sentence executive summary
  content     text not null,  -- Full report content

  report_type report_type not null,

  -- Source intelligence objects this report synthesizes
  signal_ids  uuid[] not null default '{}',
  event_ids   uuid[] not null default '{}',

  -- published_at: null = draft, set = published
  -- Reports are immutable after publication (Intelligence Evolution Framework v1.0)
  published_at timestamptz,

  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index idx_reports_type         on public.reports(report_type);
create index idx_reports_published    on public.reports(published_at desc) where published_at is not null;
create index idx_reports_signal_ids   on public.reports using gin(signal_ids);
create index idx_reports_event_ids    on public.reports using gin(event_ids);

create index idx_reports_fts
  on public.reports
  using gin(to_tsvector('english', title || ' ' || summary));

create trigger reports_updated_at
  before update on public.reports
  for each row execute function update_updated_at();

-- ── RLS ──────────────────────────────────────────────────────
alter table public.reports enable row level security;

-- Only published reports are public
create policy "Public can read published reports"
  on public.reports
  for select
  to anon, authenticated
  using (published_at is not null);

comment on table public.reports is
  'Intelligence publications. Immutable after published_at is set. '
  'Intelligence Evolution Framework v1.0: reports are permanently archived. '
  'Reference: MVP Specification v1.0 — four report types only.';
