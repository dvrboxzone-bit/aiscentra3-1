-- ============================================================
-- Migration: 20260808150000_create_ai_token_budget
-- Groq TPD (tokens-per-day) budget accounting
--
-- REAL INCIDENT this addresses, from Groq's own request logs
-- (461 rows, 2026-08-03 08:25:50Z .. 2026-08-08 12:19:44Z):
-- 24 requests were rejected with HTTP 429. Every one of them reads
--   "...on tokens per day (TPD): Limit 100000, Used <N>, Requested <M>"
-- for model llama-3.3-70b-versatile. Zero of them mention TPM.
-- The binding constraint is a DAILY TOKEN budget, which the codebase
-- previously had no concept of at all -- tpm-manager.ts tracks only
-- rolling per-MINUTE windows.
--
-- Two tables:
--   ai_token_usage  -- append-only ledger of consumed tokens
--   (no second table; the reserve split is computed, not stored)
--
-- Atomicity: consume_ai_token_budget() below does the read and the
-- write in ONE statement inside a single function call, so two
-- concurrent callers can never both observe the same "remaining"
-- value and both proceed. The previous assistant quota code did a
-- separate SELECT then UPSERT, which is a genuine race: two requests
-- arriving together could both read count=14 (limit 15) and both
-- write 15, admitting 16.
-- ============================================================

-- ── Ledger ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_token_usage (
  id           BIGSERIAL PRIMARY KEY,

  model        TEXT        NOT NULL,
  -- Which subsystem spent the tokens. Signal Engine is the priority
  -- consumer; the Assistant may only use what is left above the
  -- reserve. Both are recorded here so the budget reflects TOTAL
  -- consumption against Groq's per-model limit, not one subsystem's
  -- view of it.
  consumer     TEXT        NOT NULL CHECK (consumer IN ('signal_engine', 'assistant')),

  tokens       INT         NOT NULL CHECK (tokens >= 0),

  consumed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The only query pattern is "sum tokens for this model since T",
-- which this index serves directly.
CREATE INDEX IF NOT EXISTS idx_atu_model_time
  ON public.ai_token_usage (model, consumed_at DESC);

ALTER TABLE public.ai_token_usage ENABLE ROW LEVEL SECURITY;

-- Service-role only: never read or written from any client context.
CREATE POLICY "Service role only" ON public.ai_token_usage
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE public.ai_token_usage IS
  'Append-only ledger of Groq token consumption per model, used to
   enforce a rolling-24h TPD budget with a guaranteed Signal Engine
   reserve. Rows older than the window are only ever ignored by
   queries, never required; a periodic cleanup job may delete them.';

-- ── Atomic budget consumption ────────────────────────────────────────────────
-- Returns the decision AND the observed usage in one round trip.
--
-- p_reserve_ratio is the fraction of the limit reserved exclusively
-- for the Signal Engine (0.90 = Signal Engine is guaranteed 90%).
-- For consumer='signal_engine' the effective ceiling is the full
-- p_limit; for consumer='assistant' it is p_limit * (1 - reserve),
-- so the Assistant is refused once it would eat into the core's
-- guaranteed share -- BEFORE any Groq call is made.
CREATE OR REPLACE FUNCTION public.consume_ai_token_budget(
  p_model         TEXT,
  p_consumer      TEXT,
  p_tokens        INT,
  p_limit         INT,
  p_reserve_ratio NUMERIC,
  p_window        INTERVAL DEFAULT '24 hours'
)
RETURNS TABLE (allowed BOOLEAN, used_tokens BIGINT, ceiling_tokens INT)
LANGUAGE plpgsql
AS $$
DECLARE
  v_used    BIGINT;
  v_ceiling INT;
BEGIN
  IF p_consumer NOT IN ('signal_engine', 'assistant') THEN
    RAISE EXCEPTION 'unknown consumer: %', p_consumer;
  END IF;

  -- Serialize concurrent callers for this model. Without this, two
  -- transactions could both read the same v_used and both decide they
  -- fit. The lock key is derived from the model name so different
  -- models never block each other.
  PERFORM pg_advisory_xact_lock(hashtext('ai_token_budget:' || p_model));

  SELECT COALESCE(SUM(tokens), 0) INTO v_used
  FROM public.ai_token_usage
  WHERE model = p_model
    AND consumed_at > now() - p_window;

  -- Computed as (limit - reserved) rather than limit * (1 - reserve).
  -- The latter is subtly wrong in floating point: for limit=100000 and
  -- reserve=0.9, (1 - 0.9) evaluates to 0.09999999999999998, so
  -- FLOOR(100000 * that) yields 9999 -- silently shaving a token off
  -- the Assistant's share. Subtracting the floored reserve gives the
  -- intended 10000 exactly, and keeps the reserve itself (the value
  -- the Signal Engine is guaranteed) the exact quantity.
  v_ceiling := CASE
                 WHEN p_consumer = 'signal_engine' THEN p_limit
                 ELSE p_limit - FLOOR(p_limit * p_reserve_ratio)::INT
               END;

  IF v_used + p_tokens > v_ceiling THEN
    RETURN QUERY SELECT FALSE, v_used, v_ceiling;
    RETURN;
  END IF;

  INSERT INTO public.ai_token_usage (model, consumer, tokens)
  VALUES (p_model, p_consumer, p_tokens);

  RETURN QUERY SELECT TRUE, v_used, v_ceiling;
END;
$$;

COMMENT ON FUNCTION public.consume_ai_token_budget IS
  'Atomically checks the rolling-window TPD budget for a model and, if
   the request fits under the caller''s ceiling, records the spend in
   the same transaction. Signal Engine gets the full limit; Assistant
   gets only the non-reserved remainder. Serialized per model via
   pg_advisory_xact_lock so concurrent callers cannot both consume the
   same headroom.';

-- ── Ledger cleanup ───────────────────────────────────────────────────────────
-- Without this the append-only ledger grows unbounded: every Groq call
-- ever made leaves a row, while only rows inside the rolling window are
-- ever read.
--
-- Retention is deliberately much longer than the accounting window
-- (default 7 days vs a 24-hour window). Deleting at exactly 24h would
-- race the budget query itself -- a row could be removed microseconds
-- before a concurrent consume_ai_token_budget() call summed it, silently
-- under-counting usage and admitting a request that should have been
-- refused. A wide margin removes that class of error entirely: nothing
-- deletable is ever still relevant to a budget decision.
--
-- Atomicity is unaffected: this only ever deletes rows that are already
-- outside every possible window, so it never contends with the advisory
-- lock for a decision in flight, and it takes no lock of its own.
CREATE OR REPLACE FUNCTION public.prune_ai_token_usage(
  p_retention INTERVAL DEFAULT '7 days'
)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
  v_deleted INT;
BEGIN
  DELETE FROM public.ai_token_usage
  WHERE consumed_at < now() - p_retention;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

COMMENT ON FUNCTION public.prune_ai_token_usage IS
  'Deletes ledger rows older than the retention period (default 7 days,
   far wider than the 24-hour accounting window so pruning can never
   remove a row a concurrent budget decision still needs). Returns the
   number of rows deleted.';

-- ── Cross-platform enrichment execution lock ─────────────────────────────────
--
-- GitHub Actions' `concurrency:` only serializes runs of that ONE
-- workflow. It cannot see the Vercel cron (vercel.json ->
-- /api/cron/pipeline -> /api/enrich/batch), so claiming it prevents
-- overlap would be false: a Vercel-driven enrichment cycle and a
-- GitHub-driven one can still run simultaneously.
--
-- This lock lives in the database, which every trigger already shares,
-- so it is independent of what launched the run: GitHub schedule,
-- GitHub manual dispatch, or Vercel cron.
--
-- Deliberately a ROW, not pg_advisory_lock: an advisory lock is bound
-- to a session, and serverless functions do not hold a stable session
-- across an invocation. A row with an explicit expiry survives the
-- caller vanishing mid-run (crash, Vercel 60s kill, runner eviction)
-- and self-heals once the lease lapses -- no manual intervention, no
-- stuck lock.
--
-- It must NOT interact with consume_ai_token_budget's advisory lock:
-- these are separate mechanisms with separate scopes (one guards a
-- whole enrichment cycle, the other guards a single budget decision),
-- and the budget RPC never touches this table.
CREATE TABLE IF NOT EXISTS public.execution_locks (
  lock_name   TEXT        PRIMARY KEY,
  holder      TEXT        NOT NULL,
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL
);

ALTER TABLE public.execution_locks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role only" ON public.execution_locks
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE public.execution_locks IS
  'Platform-independent execution leases. Used to guarantee only one
   enrichment cycle runs at a time regardless of whether it was started
   by GitHub Actions (scheduled or manual) or by the Vercel cron.';

-- Acquires the lease if free or expired. Returns TRUE when acquired.
-- Expiry-based takeover is what makes a crashed holder self-healing.
CREATE OR REPLACE FUNCTION public.acquire_execution_lock(
  p_lock_name TEXT,
  p_holder    TEXT,
  p_ttl       INTERVAL DEFAULT '5 minutes'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_acquired BOOLEAN := FALSE;
BEGIN
  -- ON CONFLICT makes the whole claim a single atomic statement, so two
  -- simultaneous callers cannot both observe the lock as free.
  INSERT INTO public.execution_locks (lock_name, holder, acquired_at, expires_at)
  VALUES (p_lock_name, p_holder, now(), now() + p_ttl)
  ON CONFLICT (lock_name) DO UPDATE
    SET holder      = EXCLUDED.holder,
        acquired_at = EXCLUDED.acquired_at,
        expires_at  = EXCLUDED.expires_at
    WHERE public.execution_locks.expires_at < now()
  RETURNING TRUE INTO v_acquired;

  RETURN COALESCE(v_acquired, FALSE);
END;
$$;

-- Releases only if still held by this holder, so a run that overran its
-- lease cannot release a lock a later run has legitimately taken over.
CREATE OR REPLACE FUNCTION public.release_execution_lock(
  p_lock_name TEXT,
  p_holder    TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_released BOOLEAN := FALSE;
BEGIN
  DELETE FROM public.execution_locks
  WHERE lock_name = p_lock_name AND holder = p_holder
  RETURNING TRUE INTO v_released;

  RETURN COALESCE(v_released, FALSE);
END;
$$;
