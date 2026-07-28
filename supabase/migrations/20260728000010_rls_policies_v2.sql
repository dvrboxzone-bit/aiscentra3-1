-- ============================================================
-- Migration: 20260728000010_rls_policies_v2
-- Signal Engine V2 — Row Level Security for new tables
-- Most V2 tables are internal (service_role only)
-- knowledge_graph_nodes and entity_registry have public read
-- ============================================================

-- knowledge_graph_nodes: public read for canonical nodes (already set in migration 4)
-- entity_registry: public read for verified entities (already set in migration 5)
-- intelligence_graph: public read for high-confidence edges (already set in migration 6)
-- signal_feedback: service_role only (already set in migration 7)
-- engine_simulation_runs: service_role only (already set in migration 8)
-- signal_decision_log: service_role only (already set in migration 9)

-- ── Verification queries ──────────────────────────────────────────────────────
-- Run these to confirm RLS is active on all V2 tables:

-- SELECT tablename, rowsecurity
-- FROM pg_tables
-- WHERE schemaname = 'public'
--   AND tablename IN (
--     'knowledge_graph_nodes',
--     'entity_registry',
--     'intelligence_graph',
--     'signal_feedback',
--     'engine_simulation_runs',
--     'signal_decision_log'
--   );

-- All should show rowsecurity = true

-- ── Index verification ────────────────────────────────────────────────────────
-- SELECT indexname, tablename FROM pg_indexes
-- WHERE schemaname = 'public'
--   AND tablename IN (
--     'knowledge_graph_nodes', 'entity_registry',
--     'intelligence_graph', 'signal_decision_log'
--   )
-- ORDER BY tablename, indexname;

SELECT 'V2 migrations complete' AS status,
       count(*) AS new_tables
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'knowledge_graph_nodes',
    'entity_registry',
    'intelligence_graph',
    'signal_feedback',
    'engine_simulation_runs',
    'signal_decision_log'
  );
