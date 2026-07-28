-- ============================================================
-- Migration: 20260728000006_create_intelligence_graph
-- Signal Engine V2 — Generic entity relationship graph
-- Edges between any node types in knowledge_graph_nodes
-- ============================================================

CREATE TABLE IF NOT EXISTS public.intelligence_graph (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ── Nodes ─────────────────────────────────────────────────────────────────
  from_node_id    UUID NOT NULL REFERENCES public.knowledge_graph_nodes(id),
  to_node_id      UUID NOT NULL REFERENCES public.knowledge_graph_nodes(id),
  from_type       TEXT NOT NULL,  -- node_type of from_node
  to_type         TEXT NOT NULL,  -- node_type of to_node

  -- ── Relationship ──────────────────────────────────────────────────────────
  relation_type   TEXT NOT NULL,
  -- 'ENABLES'|'CONTRADICTS'|'DEPENDS_ON'|'PRECEDES'|'INVALIDATES'|
  -- 'DERIVED_FROM'|'AUTHORED_BY'|'PUBLISHED_IN'|'REFERENCES'|'PART_OF'

  relation_weight NUMERIC(3,2) DEFAULT 1.0,  -- strength: 0.0–1.0

  -- ── Required fields (Improvement 1 + 3) ──────────────────────────────────
  confidence      NUMERIC(3,2) NOT NULL DEFAULT 1.0,
  source          TEXT NOT NULL DEFAULT 'engine',
  -- 'engine'|'analyst'|'feedback'|'manual'|'entity_resolution'

  edge_reason     TEXT,
  -- Why this relationship exists. Required for analyst-created edges.
  -- e.g. "Paper X builds on technique from Paper Y (cited in abstract)"

  evidence        TEXT,           -- supporting text or quote

  -- ── Temporal validity ─────────────────────────────────────────────────────
  valid_until     TIMESTAMPTZ,    -- NULL = indefinite
  -- Edge may expire: "Company X used Model Y" may no longer be true

  -- ── Engine versioning ─────────────────────────────────────────────────────
  engine_version  TEXT DEFAULT 'v2.0',

  created_by      TEXT DEFAULT 'engine',
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- Indexes for graph traversal
CREATE INDEX IF NOT EXISTS idx_ig_from    ON public.intelligence_graph(from_node_id);
CREATE INDEX IF NOT EXISTS idx_ig_to      ON public.intelligence_graph(to_node_id);
CREATE INDEX IF NOT EXISTS idx_ig_rel     ON public.intelligence_graph(relation_type);
CREATE INDEX IF NOT EXISTS idx_ig_source  ON public.intelligence_graph(source);
CREATE INDEX IF NOT EXISTS idx_ig_valid   ON public.intelligence_graph(valid_until)
  WHERE valid_until IS NOT NULL;

-- Prevent duplicate edges of same type between same nodes
CREATE UNIQUE INDEX IF NOT EXISTS idx_ig_unique_edge
  ON public.intelligence_graph(from_node_id, to_node_id, relation_type)
  WHERE valid_until IS NULL;

-- RLS
ALTER TABLE public.intelligence_graph ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read high-confidence edges"
  ON public.intelligence_graph FOR SELECT
  TO anon, authenticated
  USING (confidence >= 0.7);

CREATE POLICY "Service role has full access"
  ON public.intelligence_graph FOR ALL
  TO service_role
  USING (true);

COMMENT ON TABLE public.intelligence_graph IS
  'Generic entity relationship graph for Signal Engine V2.
   Edges connect any node types: observation→entity, signal→signal,
   paper→technology, company→model, etc.
   confidence + source + valid_until make every edge a temporal, provenance-tracked object.
   edge_reason documents why the relationship was created.';
