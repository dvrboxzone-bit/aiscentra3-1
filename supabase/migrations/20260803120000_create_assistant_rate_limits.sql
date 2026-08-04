-- ============================================================
-- Migration: 20260803120000_create_assistant_rate_limits
-- Observatory Assistant — daily usage quota tracking
--
-- Two layers of protection, both enforced from this one table:
--   1. Per-IP daily cap (15 requests/day) -- prevents single-user abuse.
--   2. Global daily cap (250 requests/day, summed across all IPs) --
--      protects the shared Groq organization-level rate limit
--      (llama-3.3-70b-versatile: 1,000 requests/day on the Free plan,
--      shared with the Signal Engine's own enrichment pipeline, which
--      is the higher-priority consumer of that same budget).
--
-- IP addresses are never stored in plaintext -- only a SHA-256 hash
-- (see src/modules/assistant/quota.ts) is persisted, as a privacy-
-- conscious default even though this table is never exposed to any
-- client (service-role only, see RLS policy below).
--
-- Constitution Article 12.7: "устойчивые server-side ограничения,
-- пригодные для serverless deployment. In-memory limiter одного
-- instance не считается достаточной защитой." This table is the
-- persistent counterpart required by that rule -- Vercel serverless
-- functions do not share in-process memory across invocations.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.assistant_rate_limits (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ── Identity (privacy-conscious: hash, never raw IP) ───────────────────────
  ip_hash         TEXT NOT NULL,

  -- ── Window ──────────────────────────────────────────────────────────────
  request_date    DATE NOT NULL,  -- UTC calendar day

  -- ── Counter ─────────────────────────────────────────────────────────────
  request_count   INT NOT NULL DEFAULT 0,

  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),

  UNIQUE (ip_hash, request_date)
);

-- Fast lookup for the global daily sum (SUM(request_count) WHERE
-- request_date = today) and for cleanup of old rows.
CREATE INDEX IF NOT EXISTS idx_arl_date ON public.assistant_rate_limits(request_date);

-- RLS — this table is never read or written by any client-facing
-- context; only the server-side Assistant route (using the admin/
-- service-role client) touches it.
ALTER TABLE public.assistant_rate_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role only"
  ON public.assistant_rate_limits FOR ALL
  TO service_role
  USING (true);

COMMENT ON TABLE public.assistant_rate_limits IS
  'Observatory Assistant daily usage quota tracking. Enforces both a
   per-IP-hash daily cap and a global daily cap (summed across all
   rows for a given request_date) to protect the shared Groq
   organization-level rate limit. Rows older than a few days can be
   safely deleted by a future cleanup job -- only the current day''s
   rows are ever read.';
