-- ============================================================
-- Signal digest state — additive schema only
--
-- Safety contract:
--   * a single new table, no existing table is touched;
--   * exactly one row (id=1) tracks last_sent_at for the
--     /api/cron/signals-digest route;
--   * RLS enabled, no public policy -- only the service-role
--     client (createAdminClient()) can read/write this table,
--     matching the same pattern already used for other
--     cron/internal-only state tables in this project.
--
-- Rollback (manual, only before this feature depends on it):
-- drop table public.signal_digest_state;
-- ============================================================

CREATE TABLE IF NOT EXISTS public.signal_digest_state (
  id integer PRIMARY KEY DEFAULT 1,
  last_sent_at timestamptz NOT NULL DEFAULT '1970-01-01T00:00:00Z',
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT signal_digest_state_singleton CHECK (id = 1)
);

ALTER TABLE public.signal_digest_state ENABLE ROW LEVEL SECURITY;

-- No public/anon policy is created -- only the service-role key
-- (used exclusively server-side by the cron route) can read or
-- write this table, matching the project's own established
-- convention for internal-only cron state.
