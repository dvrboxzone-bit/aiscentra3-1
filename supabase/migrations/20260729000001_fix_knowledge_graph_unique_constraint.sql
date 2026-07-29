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

-- Catalog-checked, idempotent application distinguishing three named-vs-shape
-- scenarios explicitly rather than assuming schema+table+name+contype alone
-- is sufficient (an earlier revision of this migration did not verify the
-- exact column set — corrected here per REQUEST CHANGES review):
--
--   1. A constraint named "knowledge_graph_nodes_node_id_key" already exists
--      AND is a UNIQUE constraint on exactly the single column node_id
--      (not dropped) -> correct shape confirmed. RAISE NOTICE, no change.
--
--   2. A constraint named "knowledge_graph_nodes_node_id_key" already exists
--      but does NOT match that exact shape (wrong contype, wrong column
--      count, wrong column, or the column is dropped) -> RAISE EXCEPTION.
--      Never silently accepted, never auto-corrected, never commented on.
--
--   3. No constraint with the expected name exists, but a DIFFERENT UNIQUE
--      constraint already covers exactly node_id under another name ->
--      RAISE EXCEPTION requiring manual schema-history reconciliation.
--      Never silently treated as equivalent; never creates a second,
--      redundant constraint.
--
--   4. Neither the named constraint nor an equivalent one exists -> the
--      constraint is created. No exception handler wraps this — a native
--      PostgreSQL error (e.g. duplicate non-null node_id values) propagates
--      unmodified if creation fails.
--
-- COMMENT ON CONSTRAINT (below) is reached only if the DO block completes
-- without raising an exception — i.e. only when the constraint is already
-- confirmed correct-shape (scenario 1) or was just created with that exact
-- shape (scenario 4). It can never be applied to a same-named constraint
-- on a different column, because that case (scenario 2) always exits via
-- RAISE EXCEPTION before reaching this statement.
DO $$
DECLARE
  v_named_contype     "char";
  v_named_ncols        int;
  v_named_colname      text;
  v_named_col_dropped  boolean;
  v_named_exists       boolean := false;
  v_named_is_expected  boolean := false;
  v_other_conname      text;
BEGIN
  -- Look up the named constraint, if any, and its exact shape: type,
  -- number of columns, the single column's name (when there is exactly
  -- one), and whether that column has been dropped.
  SELECT c.contype,
         array_length(c.conkey, 1),
         a.attname,
         a.attisdropped
    INTO v_named_contype, v_named_ncols, v_named_colname, v_named_col_dropped
  FROM pg_constraint c
  JOIN pg_class t      ON t.oid = c.conrelid
  JOIN pg_namespace n  ON n.oid = t.relnamespace
  LEFT JOIN pg_attribute a
         ON a.attrelid = c.conrelid
        AND a.attnum   = c.conkey[1]
        AND array_length(c.conkey, 1) = 1
  WHERE n.nspname = 'public'
    AND t.relname = 'knowledge_graph_nodes'
    AND c.conname = 'knowledge_graph_nodes_node_id_key';

  v_named_exists := FOUND;

  IF v_named_exists THEN
    v_named_is_expected :=
      v_named_contype = 'u'
      AND v_named_ncols = 1
      AND v_named_colname = 'node_id'
      AND COALESCE(v_named_col_dropped, false) = false;

    IF v_named_is_expected THEN
      -- Scenario 1: correct shape already present.
      RAISE NOTICE
        'knowledge_graph_nodes_node_id_key already exists on public.knowledge_graph_nodes(node_id) as a UNIQUE constraint — correct shape confirmed, no change made.';
    ELSE
      -- Scenario 2: a same-named constraint exists but does not match the
      -- expected shape. Never silently accepted, never auto-corrected.
      RAISE EXCEPTION
        'A constraint named "knowledge_graph_nodes_node_id_key" exists on public.knowledge_graph_nodes but does NOT match the expected shape (UNIQUE on exactly node_id). Found: contype=%, column_count=%, column=%, column_dropped=%. Manual investigation is required before this migration can proceed.',
        v_named_contype, v_named_ncols, v_named_colname, v_named_col_dropped;
    END IF;
  ELSE
    -- No constraint with the expected name exists. Before creating one,
    -- check whether a DIFFERENT UNIQUE constraint already covers exactly
    -- node_id under another name — never assume equivalence silently.
    SELECT c.conname INTO v_other_conname
    FROM pg_constraint c
    JOIN pg_class t      ON t.oid = c.conrelid
    JOIN pg_namespace n  ON n.oid = t.relnamespace
    JOIN pg_attribute a  ON a.attrelid = c.conrelid
                        AND a.attnum   = c.conkey[1]
    WHERE n.nspname = 'public'
      AND t.relname = 'knowledge_graph_nodes'
      AND c.contype = 'u'
      AND array_length(c.conkey, 1) = 1
      AND a.attname = 'node_id'
      AND a.attisdropped = false
    LIMIT 1;

    IF v_other_conname IS NOT NULL THEN
      -- Scenario 3: an equivalent constraint exists under a different name.
      -- Stop and require a human decision rather than creating a second,
      -- redundant constraint.
      RAISE EXCEPTION
        'Equivalent UNIQUE constraint "%" already exists on public.knowledge_graph_nodes(node_id) under a different name. Manual schema-history reconciliation is required.',
        v_other_conname;
    ELSE
      -- Scenario 4: neither the named constraint nor an equivalent one
      -- exists. No exception handler wraps this statement — a native
      -- PostgreSQL error (e.g. duplicate non-null node_id values already
      -- present) propagates unmodified if creation fails.
      ALTER TABLE public.knowledge_graph_nodes
        ADD CONSTRAINT knowledge_graph_nodes_node_id_key UNIQUE (node_id);
      RAISE NOTICE
        'Added UNIQUE constraint knowledge_graph_nodes_node_id_key on public.knowledge_graph_nodes(node_id).';
    END IF;
  END IF;
END $$;

COMMENT ON CONSTRAINT knowledge_graph_nodes_node_id_key ON public.knowledge_graph_nodes IS
  'Required for ingestToKnowledgeGraph()''s upsert(onConflict:"node_id") to function.
   Was missing since table creation (migration 20260728000004) — root cause of the
   Knowledge Graph remaining empty despite active ingestion code. Fixed in Phase 2.
   Applied directly to production prior to Constitution v2.0 governance process
   being in effect for this repository — see file header for full disclosure.';
