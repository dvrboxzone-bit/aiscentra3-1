-- ============================================================
-- AIscentra Migration 004
-- Signals Table — Primary Intelligence Object
-- Reference: Signal Scoring Specification v1.0 (complete)
-- This is the most important table in the Observatory.
-- ============================================================

create table public.signals (
  id           uuid primary key default uuid_generate_v4(),

  -- Identity
  title        text not null
               check (char_length(title) >= 10 and char_length(title) <= 80),   -- VAL-01
  description  text not null
               check (char_length(description) >= 50 and char_length(description) <= 500), -- VAL-02
  category     signal_category not null,
  status       signal_status not null default 'CANDIDATE',

  -- ── Raw Factor Scores (0–10 each) ────────────────────────
  -- Stored separately from computed scores.
  -- Reason: enables re-weighting without re-generation,
  -- and audit of what the AI agent actually returned.
  -- Signal Scoring Spec v1.0: "server-side score computation from raw factors
  -- prevents direct agent score inflation"
  impact_factor           smallint not null default 0 check (impact_factor between 0 and 10),
  actor_factor            smallint not null default 0 check (actor_factor between 0 and 10),
  novelty_factor          smallint not null default 0 check (novelty_factor between 0 and 10),
  verifiability_factor    smallint not null default 0 check (verifiability_factor between 0 and 10),
  strategic_factor        smallint not null default 0 check (strategic_factor between 0 and 10),
  authority_factor        smallint not null default 0 check (authority_factor between 0 and 10),
  corroboration_factor    smallint not null default 0 check (corroboration_factor between 0 and 10),
  specificity_factor      smallint not null default 0 check (specificity_factor between 0 and 10),
  category_confidence_factor smallint not null default 0 check (category_confidence_factor between 0 and 10),
  consistency_factor      smallint not null default 7   -- Defaults to 7 for first 30 days (Signal Spec 6.6)
                          check (consistency_factor between 0 and 10),

  -- ── Computed Scores (0–100 integers) ─────────────────────
  -- Derived server-side using formulas from Signal Scoring Spec v1.0
  -- signal_score     = round((impact×0.25 + actor×0.25 + novelty×0.20 + verifiability×0.15 + strategic×0.15) × 10)
  -- confidence_score = round((authority×0.30 + corroboration×0.25 + specificity×0.20 + category_conf×0.15 + consistency×0.10) × 10)
  -- momentum_score   = min(100, round(base_momentum × e^(-0.05 × days_since_creation)))
  signal_score     smallint not null default 0 check (signal_score between 0 and 100),
  confidence_score smallint not null default 0 check (confidence_score between 0 and 100),
  momentum_score   smallint not null default 0 check (momentum_score between 0 and 100),

  -- ── Lifecycle ─────────────────────────────────────────────
  validation_flags    text[]    not null default '{}',
  manual_override     boolean   not null default false,
  expiration_reason   text,
  expired_at          timestamptz,

  -- ── Relations ─────────────────────────────────────────────
  observation_ids uuid[] not null default '{}',  -- VAL-08: at least one required for ACTIVE
  entity_ids      uuid[] not null default '{}',

  -- ── Momentum tracking ─────────────────────────────────────
  momentum_last_calculated timestamptz,

  -- ── Audit (MVP: JSONB — full audit table in Stage 12) ────
  -- Intelligence Evolution Framework v1.0: immutable after activation
  -- Updates recorded here, never by overwriting original values
  metadata jsonb not null default '{}'::jsonb,
  -- metadata structure:
  -- {
  --   "audit_log": [{ "field", "from", "to", "at", "by", "reason" }],
  --   "enrichment_model": "anthropic/claude-3-haiku",
  --   "enriched_at": "2025-01-15T...",
  --   "momentum_calculation": { "new_observations_count", "distinct_source_count", ... }
  -- }

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Back-reference from observations to signal
alter table public.observations
  add constraint observations_signal_id_fkey
  foreign key (signal_id) references public.signals(id) on delete set null;

-- ── Indexes ───────────────────────────────────────────────────
-- Primary query patterns from the Observatory interface:

-- Signal feed: active signals, newest first
create index idx_signals_active_feed
  on public.signals(created_at desc)
  where status = 'ACTIVE';

-- Category filter (most common UI filter)
create index idx_signals_category_status
  on public.signals(category, status, created_at desc);

-- Severity filter: CRITICAL (80+) and HIGH (60+) daily check
create index idx_signals_score
  on public.signals(signal_score desc)
  where status = 'ACTIVE';

-- Promotion queue: signals eligible for event creation
-- Signal Scoring Spec v1.0 Section 09: signal_score ≥ 70 AND confidence_score ≥ 65
create index idx_signals_promotion_eligible
  on public.signals(signal_score desc, confidence_score desc)
  where status = 'ACTIVE'
    and signal_score >= 70
    and confidence_score >= 65;

-- Momentum recalculation: find signals due for update
create index idx_signals_momentum_update
  on public.signals(momentum_last_calculated asc nulls first)
  where status = 'ACTIVE';

-- Expiration check: find signals past their window
create index idx_signals_expiration
  on public.signals(category, created_at)
  where status = 'ACTIVE';

-- Entity lookup: find all signals for a given entity
create index idx_signals_entity_ids
  on public.signals using gin(entity_ids);

-- Full-text search on title and description
create index idx_signals_fts
  on public.signals
  using gin(to_tsvector('english', title || ' ' || description));

-- Updated_at trigger
create trigger signals_updated_at
  before update on public.signals
  for each row execute function update_updated_at();

-- ── RLS ──────────────────────────────────────────────────────
alter table public.signals enable row level security;

-- Public can read ACTIVE and PROMOTED signals only
-- Expired and rejected signals are internal (historical queries via service role)
create policy "Public can read active signals"
  on public.signals
  for select
  to anon, authenticated
  using (status in ('ACTIVE', 'PROMOTED'));

-- Service role (pipeline agents, admin) has full access — bypasses RLS

comment on table public.signals is
  'Primary intelligence object of the Observatory. '
  'Central entity per AIscentra Constitution v1.0. '
  'Scoring: Signal Scoring Specification v1.0. '
  'Signals are immutable after activation — updates recorded in metadata.audit_log. '
  'Intelligence Evolution Framework v1.0, Section 10.';
