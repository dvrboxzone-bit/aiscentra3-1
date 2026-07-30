-- ============================================================
-- Migration: 20260729000001_fix_knowledge_graph_unique_constraint
-- Phase 2: Knowledge Foundation for Agent Intelligence
--
-- STATUS: This file documents and, where absent, creates a NOT DEFERRABLE
-- UNIQUE constraint on public.knowledge_graph_nodes(node_id). It exists so
-- this constraint can be reproducibly created in any environment lacking
-- it, and so the migration history reflects the currently-verified state
-- of production (Constitution Article 1.2).
--
-- VERIFIED FACTS (confirmed via direct, machine-executed read-only catalog
-- queries against production, and via a PostgreSQL 17 CI run of this exact
-- migration file — see migration file and Draft PR #1 for the evidence
-- summary, CI identifiers, and disclosed limitations):
--   - public.knowledge_graph_nodes.node_id is a nullable uuid column.
--   - A constraint named knowledge_graph_nodes_node_id_key currently exists
--     in production with the exact shape this migration targets: UNIQUE on
--     exactly node_id, NOT DEFERRABLE, backing index valid/ready/live/
--     immediate — independently VERIFIED, not merely asserted.
--   - No duplicate non-null node_id values exist in production.
--   - Production currently contains 6 rows in this table.
--   - No entry for migration version 20260729000001 exists in
--     supabase_migrations.schema_migrations in production.
--   - This exact migration file, executed against a PostgreSQL 17 service
--     container in GitHub Actions CI, passed all 8 scored scenarios
--     (clean-schema creation, idempotent repeat, three distinct
--     wrong-shape/conflicting-constraint rejection scenarios, duplicate-data
--     rejection, and ON CONFLICT arbiter compatibility) and surfaced one
--     disclosed known limitation (Scenario 9 — see PR #1).
--
-- NOT ESTABLISHED BY CURRENT EVIDENCE (stated as such, not as fact):
--   - Whether the constraint currently present in production existed
--     before this migration file was first committed or reviewed, and if
--     so, which specific tool or method created it and at what exact time,
--     is not established by any artifact collected so far.
--   - Whether the constraint's absence caused any specific historical
--     period of zero rows, and whether the current 6 rows were written by
--     ingestToKnowledgeGraph() specifically (as opposed to some other
--     path), is not established by any artifact collected so far. The code
--     dependency described below is a verified property of the source code
--     itself, not a verified causal history of the data.
--
-- CODE DEPENDENCY (verified by direct reading of source, independent of the
-- historical questions above): knowledge_graph_nodes had no UNIQUE
-- constraint on node_id at table-creation time (migration 20260728000004
-- only created a regular, non-unique index, idx_kgn_node_id). Signal
-- Engine's ingestToKnowledgeGraph() (src/modules/signals/engine.ts) calls
-- .upsert({...}, { onConflict: 'node_id' }) on every observation processed.
-- PostgreSQL's ON CONFLICT (node_id) clause requires a suitable NOT
-- DEFERRABLE UNIQUE constraint or a suitable unique index covering
-- exactly that column as its arbiter -- exclusion constraints are not
-- supported as ON CONFLICT DO UPDATE arbiters. Without such a structure,
-- this upsert call fails at the database level; the calling code wraps
-- this in try/catch { return null }, which would silently absorb that
-- specific failure without surfacing it. This migration intentionally
-- creates a named NOT DEFERRABLE UNIQUE constraint satisfying that
-- requirement in any environment lacking one. No Signal Engine code is
-- modified by this migration — the fix is purely at the schema level.
-- ============================================================

-- Catalog-checked, idempotent application distinguishing five named-vs-shape
-- scenarios explicitly rather than assuming schema+table+name+contype+column
-- alone is sufficient (corrected across two REQUEST CHANGES review rounds):
--
--   1. A constraint named "knowledge_graph_nodes_node_id_key" already exists
--      AND is a UNIQUE constraint on exactly the single column node_id
--      (not dropped) AND is NOT DEFERRABLE -> correct shape confirmed.
--      RAISE NOTICE, no change.
--
--   2. A constraint named "knowledge_graph_nodes_node_id_key" already exists
--      but does NOT match that exact shape (wrong contype, wrong column
--      count, wrong column, dropped column, OR is DEFERRABLE) ->
--      RAISE EXCEPTION. Never silently accepted, never auto-corrected,
--      never commented on. A DEFERRABLE UNIQUE constraint cannot serve as
--      an arbiter for INSERT ... ON CONFLICT (PostgreSQL does not permit
--      deferrable constraints in that role), so it is treated as wrong
--      shape even though contype/column/dropped all otherwise match.
--
--   3a. No constraint with the expected name exists, but a DIFFERENT
--       NOT DEFERRABLE UNIQUE constraint already covers exactly node_id
--       under another name -> RAISE EXCEPTION: a functionally equivalent
--       constraint exists under a different name; manual schema-history
--       reconciliation required. No second constraint created.
--
--   3b. No constraint with the expected name exists, but a DIFFERENT
--       DEFERRABLE UNIQUE constraint already covers exactly node_id under
--       another name -> RAISE EXCEPTION: that constraint exists but cannot
--       serve as an ON CONFLICT arbiter; manual reconciliation required
--       before proceeding. No second constraint created.
--
--   4. Neither the named constraint nor any constraint on node_id exists
--      -> the constraint is created, explicitly NOT DEFERRABLE. No
--      exception handler wraps this — a native PostgreSQL error (e.g.
--      duplicate non-null node_id values) propagates unmodified if
--      creation fails.
--
-- Expected constraint shape (all five conditions required simultaneously):
--   - type: UNIQUE
--   - columns: exactly node_id
--   - dropped column: false
--   - deferrable: false
--   -> suitable as an arbiter for INSERT ... ON CONFLICT('node_id'), which
--      ingestToKnowledgeGraph() (src/modules/signals/engine.ts) requires.
--   Note: contype/column/dropped alone do NOT constitute a fully-verified
--   shape — condeferrable must also be confirmed false, since PostgreSQL
--   does not allow a DEFERRABLE unique constraint to act as an ON CONFLICT
--   arbiter even though it is otherwise a valid UNIQUE constraint.
--
-- COMMENT ON CONSTRAINT (below) is reached only if the DO block completes
-- without raising an exception — i.e. only when the constraint is already
-- confirmed correct-shape (scenario 1) or was just created with that exact
-- shape (scenario 4). Every ambiguous or incorrect scenario (2, 3a, 3b)
-- exits via RAISE EXCEPTION before reaching this statement.
DO $$
DECLARE
  v_named_contype      "char";
  v_named_ncols         int;
  v_named_colname       text;
  v_named_col_dropped   boolean;
  v_named_deferrable    boolean;
  v_named_exists        boolean := false;
  v_named_is_expected   boolean := false;
  v_other_conname       text;
  v_other_deferrable    boolean;
BEGIN
  -- Look up the named constraint, if any, and its exact shape: type,
  -- number of columns, the single column's name (when there is exactly
  -- one), whether that column has been dropped, and whether the
  -- constraint itself is deferrable.
  SELECT c.contype,
         array_length(c.conkey, 1),
         a.attname,
         a.attisdropped,
         c.condeferrable
    INTO v_named_contype, v_named_ncols, v_named_colname, v_named_col_dropped, v_named_deferrable
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
      AND COALESCE(v_named_col_dropped, false) = false
      AND v_named_deferrable = false;

    IF v_named_is_expected THEN
      -- Scenario 1: correct shape already present (UNIQUE, exactly
      -- node_id, not dropped, NOT DEFERRABLE — valid ON CONFLICT arbiter).
      RAISE NOTICE
        'knowledge_graph_nodes_node_id_key already exists on public.knowledge_graph_nodes(node_id) as a NOT DEFERRABLE UNIQUE constraint — correct shape confirmed, no change made.';
    ELSE
      -- Scenario 2: a same-named constraint exists but does not match the
      -- expected shape (including the case where it is DEFERRABLE, which
      -- disqualifies it as an ON CONFLICT arbiter even though contype,
      -- column, and dropped-state may otherwise be correct). Never
      -- silently accepted, never auto-corrected.
      RAISE EXCEPTION
        'A constraint named "knowledge_graph_nodes_node_id_key" exists on public.knowledge_graph_nodes but does NOT match the expected shape (UNIQUE on exactly node_id, NOT DEFERRABLE). Found: contype=%, column_count=%, column=%, column_dropped=%, deferrable=%. Manual investigation is required before this migration can proceed.',
        v_named_contype, v_named_ncols, v_named_colname, v_named_col_dropped, v_named_deferrable;
    END IF;
  ELSE
    -- No constraint with the expected name exists. Before creating one,
    -- check whether a DIFFERENT constraint already covers exactly node_id
    -- under another name — never assume equivalence silently, and
    -- distinguish a functionally-equivalent (NOT DEFERRABLE) constraint
    -- from one that superficially matches but cannot serve as an ON
    -- CONFLICT arbiter (DEFERRABLE).
    SELECT c.conname, c.condeferrable
      INTO v_other_conname, v_other_deferrable
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

    IF v_other_conname IS NOT NULL AND v_other_deferrable = false THEN
      -- Scenario 3a: a functionally equivalent (NOT DEFERRABLE) UNIQUE
      -- constraint exists under a different name. Stop and require a
      -- human decision rather than creating a second, redundant constraint.
      RAISE EXCEPTION
        'Functionally equivalent NOT DEFERRABLE UNIQUE constraint "%" already exists on public.knowledge_graph_nodes(node_id) under a different name. Manual schema-history reconciliation is required.',
        v_other_conname;
    ELSIF v_other_conname IS NOT NULL AND v_other_deferrable = true THEN
      -- Scenario 3b: a UNIQUE constraint on node_id exists under a
      -- different name, but it is DEFERRABLE and therefore cannot serve
      -- as an ON CONFLICT arbiter. Stop rather than silently accepting it
      -- or silently creating a second constraint.
      RAISE EXCEPTION
        'A UNIQUE constraint "%" exists on public.knowledge_graph_nodes(node_id) under a different name, but it is DEFERRABLE and therefore cannot be used as an arbiter for INSERT ... ON CONFLICT. Manual reconciliation is required before this migration can proceed.',
        v_other_conname;
    ELSE
      -- Scenario 4: no constraint on node_id exists at all, named or
      -- otherwise. No exception handler wraps this statement — a native
      -- PostgreSQL error (e.g. duplicate non-null node_id values already
      -- present) propagates unmodified if creation fails. Explicitly
      -- NOT DEFERRABLE so the resulting constraint is guaranteed usable
      -- as an ON CONFLICT arbiter (this is also PostgreSQL's default when
      -- DEFERRABLE is omitted, but is stated explicitly here for clarity).
      ALTER TABLE public.knowledge_graph_nodes
        ADD CONSTRAINT knowledge_graph_nodes_node_id_key
        UNIQUE (node_id)
        NOT DEFERRABLE;
      RAISE NOTICE
        'Added NOT DEFERRABLE UNIQUE constraint knowledge_graph_nodes_node_id_key on public.knowledge_graph_nodes(node_id).';
    END IF;
  END IF;
END $$;

COMMENT ON CONSTRAINT knowledge_graph_nodes_node_id_key ON public.knowledge_graph_nodes IS
  'NOT DEFERRABLE UNIQUE constraint on node_id. Required so that
   ingestToKnowledgeGraph()''s upsert(onConflict:"node_id") call
   (src/modules/signals/engine.ts) has a suitable NOT DEFERRABLE UNIQUE
   constraint or unique index to use node_id as its ON CONFLICT arbiter --
   exclusion constraints are not supported in that role, and a DEFERRABLE
   unique constraint cannot serve as one either. Documented and, where
   absent, created by migration 20260729000001. See that migration file
   and Draft PR #1 for the evidence summary, CI identifiers, and disclosed
   limitations regarding this constraint''s current shape and history.';
