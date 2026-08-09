-- ============================================================
-- Migration: 20260809040000_harden_ai_token_budget_grants
-- Hardening pass for 20260808150000_create_ai_token_budget.sql --
-- that file is NOT modified; this is a separate, additive migration.
--
-- REAL FINDINGS this closes, confirmed directly against production
-- (fokoxewjfjvqahkidagb) via information_schema, not assumed:
--
-- 1. `anon` and `authenticated` both held FULL table privileges
--    (SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER) on both
--    public.ai_token_usage and public.execution_locks. This is
--    Supabase's own schema-level default privilege grant, not
--    anything this project's migration set explicitly -- the original
--    migration only enabled RLS and added a service_role policy, which
--    is a ROW-level filter; it does not by itself remove the
--    TABLE-level grant that lets anon/authenticated attempt a query in
--    the first place. RLS was the only thing standing between a public
--    API caller and these tables.
--
-- 2. `PUBLIC` (and therefore anon/authenticated, which inherit it) held
--    EXECUTE on all four functions -- Postgres's default for any newly
--    created function unless EXECUTE is explicitly revoked. Each is
--    reachable today via Supabase's auto-exposed
--    /rest/v1/rpc/<function_name> endpoint by anyone holding the
--    project's public anon key.
--
-- 3. Supabase's own Security Advisor reports exactly four
--    `function_search_path_mutable` (WARN) findings, one per function
--    in the original migration -- none had search_path pinned, so
--    each resolves unqualified identifiers against whatever
--    search_path the CALLING session has, not a fixed one. All four
--    functions already fully schema-qualify every table reference
--    (public.ai_token_usage, public.execution_locks), so pinning
--    search_path here changes no behavior -- it only removes the
--    class of risk the advisor is warning about (a caller-controlled
--    search_path affecting an unqualified reference this code doesn't
--    actually have).
--
-- Nothing here changes RLS, table structure, or function logic --
-- REVOKE/GRANT and ALTER FUNCTION ... SET search_path only.
-- ============================================================

-- ── 1. Table-level privileges: service_role only ────────────────────────────
-- RLS already restricts actual ROW visibility to service_role; this
-- additionally removes the base privilege that lets PUBLIC/anon/
-- authenticated attempt a query at all, per the principle of least
-- privilege -- defense in depth, not a behavior change (RLS was already
-- blocking real access; this closes the remaining, unnecessary surface).
REVOKE ALL ON public.ai_token_usage FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.execution_locks FROM PUBLIC, anon, authenticated;

GRANT ALL ON public.ai_token_usage TO service_role;
GRANT ALL ON public.execution_locks TO service_role;

-- `ai_token_usage.id BIGSERIAL` implicitly created a separate sequence
-- object (ai_token_usage_id_seq). GRANT ALL ON the table does NOT
-- extend to a table's own serial sequence in Postgres -- that is a
-- distinct, commonly-missed object requiring its own explicit grant.
-- Confirmed as a REAL gap, not theoretical: without this,
-- consume_ai_token_budget()'s own INSERT fails with "permission denied
-- for sequence ai_token_usage_id_seq" when actually invoked as
-- service_role (reproduced directly while writing the integration test
-- below -- the original migration relied on Supabase's ambient
-- schema-level default privileges for this, which is implicit and not
-- guaranteed; making it explicit here is itself part of this
-- migration's hardening intent, not a workaround).
GRANT USAGE, SELECT ON SEQUENCE public.ai_token_usage_id_seq TO service_role;
REVOKE ALL ON SEQUENCE public.ai_token_usage_id_seq FROM PUBLIC, anon, authenticated;

-- ── 2. Function execute privileges: service_role only ───────────────────────
-- Explicitly revoking from PUBLIC also removes it from anon/
-- authenticated, since both inherit PUBLIC's grants in Postgres unless
-- separately revoked -- revoking all three here removes any ambiguity
-- about which grant is actually in effect.
REVOKE EXECUTE ON FUNCTION public.consume_ai_token_budget(TEXT, TEXT, INT, INT, NUMERIC, INTERVAL)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prune_ai_token_usage(INTERVAL)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.acquire_execution_lock(TEXT, TEXT, INTERVAL)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_execution_lock(TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.consume_ai_token_budget(TEXT, TEXT, INT, INT, NUMERIC, INTERVAL)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.prune_ai_token_usage(INTERVAL)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.acquire_execution_lock(TEXT, TEXT, INTERVAL)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.release_execution_lock(TEXT, TEXT)
  TO service_role;

-- ── 3. Fixed search_path on all four functions ───────────────────────────────
-- pg_catalog only (not pg_catalog, public): every table reference in
-- all four functions is already fully schema-qualified
-- (public.ai_token_usage / public.execution_locks), so there is no
-- unqualified identifier that needs `public` on the path to resolve.
-- Pinning to the minimal pg_catalog closes the advisor finding without
-- widening the resolvable surface any further than required.
ALTER FUNCTION public.consume_ai_token_budget(TEXT, TEXT, INT, INT, NUMERIC, INTERVAL)
  SET search_path = pg_catalog;
ALTER FUNCTION public.prune_ai_token_usage(INTERVAL)
  SET search_path = pg_catalog;
ALTER FUNCTION public.acquire_execution_lock(TEXT, TEXT, INTERVAL)
  SET search_path = pg_catalog;
ALTER FUNCTION public.release_execution_lock(TEXT, TEXT)
  SET search_path = pg_catalog;
