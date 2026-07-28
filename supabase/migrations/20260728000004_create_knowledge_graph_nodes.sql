-- ============================================================
-- Migration: 20260728000004_create_knowledge_graph_nodes
-- Signal Engine V2 — Primary graph storage layer
-- Observations become graph entities before Signal generation
-- ============================================================

CREATE TABLE IF NOT EXISTS public.knowledge_graph_nodes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ── Node identity ─────────────────────────────────────────────────────────
  node_type       TEXT NOT NULL,
  -- 'observation'|'signal'|'entity'|'technology'|'company'|'paper'|
  -- 'model'|'person'|'event'|'concept'|'dataset'|'benchmark'|'product'

  node_id         UUID,           -- FK to source table (observations.id, signals.id, etc.)
  canonical_id    UUID,           -- self-reference after entity resolution
  is_canonical    BOOLEAN DEFAULT true,

  -- ── Node content ──────────────────────────────────────────────────────────
  label           TEXT NOT NULL,
  aliases         TEXT[] DEFAULT '{}',
  description     TEXT,
  properties      JSONB DEFAULT '{}',

  -- ── Graph metadata ────────────────────────────────────────────────────────
  importance_score NUMERIC(4,2),  -- computed from graph centrality (future)
  source_count     INTEGER DEFAULT 1,
  embedding_ready  BOOLEAN DEFAULT false,  -- for future vector search

  -- ── Engine versioning ─────────────────────────────────────────────────────
  engine_version  TEXT DEFAULT 'v2.0',

  first_seen      TIMESTAMPTZ DEFAULT now(),
  last_updated    TIMESTAMPTZ DEFAULT now(),
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Indexes for graph traversal
CREATE INDEX IF NOT EXISTS idx_kgn_type      ON public.knowledge_graph_nodes(node_type);
CREATE INDEX IF NOT EXISTS idx_kgn_node_id   ON public.knowledge_graph_nodes(node_id);
CREATE INDEX IF NOT EXISTS idx_kgn_canonical ON public.knowledge_graph_nodes(canonical_id);
CREATE INDEX IF NOT EXISTS idx_kgn_label     ON public.knowledge_graph_nodes(label);
CREATE INDEX IF NOT EXISTS idx_kgn_aliases   ON public.knowledge_graph_nodes USING GIN(aliases);

-- RLS
ALTER TABLE public.knowledge_graph_nodes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read canonical nodes"
  ON public.knowledge_graph_nodes FOR SELECT
  TO anon, authenticated
  USING (is_canonical = true);

COMMENT ON TABLE public.knowledge_graph_nodes IS
  'Primary storage layer for Signal Engine V2.
   Observations become nodes before Signal generation.
   Signals are generated from graph understanding, not raw observations.';
