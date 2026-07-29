-- ============================================================
-- Migration: 20260729000001_fix_knowledge_graph_unique_constraint
-- Phase 2: Knowledge Foundation for Agent Intelligence
--
-- STATUS NOTE (disclosed, not hidden): This constraint was already applied
-- directly to production (project fokoxewjfjvqahkidagb) via Supabase MCP
-- execute_sql, BEFORE AISCENTRA_PROJECT_CONSTITUTION_v2.0 was loaded into
-- this session and before any backup/staging/PR process existed for this
-- repository. This file is a RETROACTIVE record of that change, committed
-- so the migration history accurately reflects the live schema (Constitution
-- Article 1.2: primary artifacts must match reality) — not a claim that the
-- change followed the now-required governance process, which it did not.
--
-- ROOT CAUSE FIX: knowledge_graph_nodes had no UNIQUE constraint on
-- node_id, only a regular (non-unique) index (idx_kgn_node_id).
-- Signal Engine's ingestToKnowledgeGraph() (src/modules/signals/engine.ts)
-- calls .upsert({...}, { onConflict: 'node_id' }) on every observation
-- processed — this REQUIRES a unique constraint on node_id to function.
-- Without one, the upsert fails at the database level. The calling code
-- wraps this in try/catch { return null } (silent failure by design, to
-- avoid blocking Signal creation on a non-critical side effect), which
-- meant the table remained empty (0 rows, confirmed via direct SQL
-- inspection) despite the ingestion code running on every observation
-- since Signal Engine V2 was deployed. This is a genuine bug, not "data
-- simply not yet populated," which is how it was previously characterized
-- in PROJECT_MASTER_DOCUMENTATION.md.
--
-- This migration adds the missing constraint. No Signal Engine code is
-- modified — the fix is purely at the schema level, restoring the
-- constraint the application code already assumed existed.
-- ============================================================

-- Idempotent, catalog-checked application: verifies schema + table + exact
-- constraint name + constraint type (contype = 'u' for UNIQUE) + exact column
-- set before applying. Safe to run whether the constraint already exists
-- (e.g. applied directly to production prior to this migration being
-- committed) or does not yet exist (fresh/staging environments).
--
-- Does NOT swallow errors: if the ADD CONSTRAINT statement fails for any
-- other reason (e.g. existing duplicate node_id values preventing a UNIQUE
-- constraint from being created), PostgreSQL's native error propagates
-- unmodified — there is no exception handler here to hide it.
--
-- Does NOT silently treat a differently-named constraint on the same
-- column as equivalent: if one is found, a NOTICE is raised so the
-- discrepancy is visible in migration logs rather than assumed away.
DO $$
DECLARE
  exact_match_exists boolean;
  other_unique_on_node_id text;
BEGIN
  -- Exact match: same schema, table, constraint name, and type (UNIQUE).
  SELECT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t      ON t.oid = c.conrelid
    JOIN pg_namespace n  ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'knowledge_graph_nodes'
      AND c.conname = 'knowledge_graph_nodes_node_id_key'
      AND c.contype = 'u'
  ) INTO exact_match_exists;

  IF exact_match_exists THEN
    RAISE NOTICE
      'knowledge_graph_nodes_node_id_key already exists on public.knowledge_graph_nodes — skipping, no change made.';
  ELSE
    -- Surface (do not silently assume equivalence with) any other UNIQUE
    -- constraint that already covers exactly the node_id column, under a
    -- different name.
    SELECT c.conname INTO other_unique_on_node_id
    FROM pg_constraint c
    JOIN pg_class t      ON t.oid = c.conrelid
    JOIN pg_namespace n  ON n.oid = t.relnamespace
    JOIN pg_attribute a  ON a.attrelid = t.oid AND a.attnum = ANY(c.conkey)
    WHERE n.nspname = 'public'
      AND t.relname = 'knowledge_graph_nodes'
      AND c.contype = 'u'
      AND a.attname = 'node_id'
      AND array_length(c.conkey, 1) = 1
    LIMIT 1;

    IF other_unique_on_node_id IS NOT NULL THEN
      RAISE NOTICE
        'A differently-named UNIQUE constraint (%) already covers node_id on public.knowledge_graph_nodes. Proceeding to add knowledge_graph_nodes_node_id_key as well — not assuming equivalence.',
        other_unique_on_node_id;
    END IF;

    -- Native PostgreSQL error (e.g. duplicate node_id values already present)
    -- propagates as-is if this statement fails. No exception handler wraps it.
    ALTER TABLE public.knowledge_graph_nodes
      ADD CONSTRAINT knowledge_graph_nodes_node_id_key UNIQUE (node_id);
  END IF;
END $$;

COMMENT ON CONSTRAINT knowledge_graph_nodes_node_id_key ON public.knowledge_graph_nodes IS
  'Required for ingestToKnowledgeGraph()''s upsert(onConflict:"node_id") to function.
   Was missing since table creation (migration 20260728000004) — root cause of the
   Knowledge Graph remaining empty despite active ingestion code. Fixed in Phase 2.
   Applied directly to production prior to Constitution v2.0 governance process
   being in effect for this repository — see file header for full disclosure.';
