-- ============================================================
-- Migration: 20260728000005_create_entity_registry
-- Signal Engine V2 — Canonical entity resolution
-- Different names for same entity resolve to single canonical record
-- ============================================================

CREATE TABLE IF NOT EXISTS public.entity_registry (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ── Canonical identity ────────────────────────────────────────────────────
  canonical_name  TEXT NOT NULL UNIQUE,
  entity_type     TEXT NOT NULL,
  -- 'company'|'model'|'technology'|'person'|'paper'|
  -- 'benchmark'|'dataset'|'concept'|'product'|'platform'

  canonical_id    UUID REFERENCES public.knowledge_graph_nodes(id),

  -- ── Alias resolution ──────────────────────────────────────────────────────
  aliases         TEXT[] NOT NULL DEFAULT '{}',
  alias_sources   JSONB  DEFAULT '{}',
  -- {"Open AI": "source_observation_id", "openai inc": "manual"}

  description     TEXT,
  properties      JSONB DEFAULT '{}',

  -- ── External identifiers ──────────────────────────────────────────────────
  -- Supports any namespace. Known namespaces:
  -- doi, arxiv, github, crunchbase, openalex, semantic_scholar,
  -- huggingface, wikipedia, ror, wikidata, linkedin
  external_ids    JSONB DEFAULT '{}',
  -- {
  --   "arxiv":            "2301.07041",
  --   "doi":              "10.48550/arXiv.2301.07041",
  --   "github":           "openai/gpt-2",
  --   "crunchbase":       "openai",
  --   "openalex":         "W2963403153",
  --   "semantic_scholar": "204e3073870fae3d05bcbc2f6a8e263d9b72e776",
  --   "huggingface":      "meta-llama/Llama-2-70b",
  --   "wikipedia":        "OpenAI",
  --   "ror":              "https://ror.org/02nr0ka47"
  -- }

  -- ── Resolution metadata ───────────────────────────────────────────────────
  confidence      NUMERIC(3,2) DEFAULT 1.0,
  resolved_by     TEXT DEFAULT 'engine',  -- 'engine'|'analyst'|'manual'
  verified        BOOLEAN DEFAULT false,

  -- ── Usage tracking ────────────────────────────────────────────────────────
  signal_count    INTEGER DEFAULT 0,

  -- ── Engine versioning ─────────────────────────────────────────────────────
  engine_version  TEXT DEFAULT 'v2.0',

  first_seen      TIMESTAMPTZ DEFAULT now(),
  last_updated    TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_er_canonical    ON public.entity_registry(canonical_name);
CREATE INDEX IF NOT EXISTS idx_er_type         ON public.entity_registry(entity_type);
CREATE INDEX IF NOT EXISTS idx_er_aliases      ON public.entity_registry USING GIN(aliases);
CREATE INDEX IF NOT EXISTS idx_er_external_ids ON public.entity_registry USING GIN(external_ids);
CREATE INDEX IF NOT EXISTS idx_er_verified     ON public.entity_registry(verified);

-- RLS
ALTER TABLE public.entity_registry ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read verified entities"
  ON public.entity_registry FOR SELECT
  TO anon, authenticated
  USING (verified = true);

CREATE POLICY "Service role has full access"
  ON public.entity_registry FOR ALL
  TO service_role
  USING (true);

-- ── Seed: Canonical entities ──────────────────────────────────────────────────
INSERT INTO public.entity_registry
  (canonical_name, entity_type, aliases, verified, resolved_by)
VALUES
  ('OpenAI',          'company',   ARRAY['Open AI','openai','OpenAI Inc','OpenAI LP','OpenAI LLC'],         true, 'manual'),
  ('Anthropic',       'company',   ARRAY['anthropic','Anthropic AI','Anthropic PBC'],                       true, 'manual'),
  ('Google DeepMind', 'company',   ARRAY['DeepMind','Google Brain','GDM','deepmind','Google AI'],           true, 'manual'),
  ('Meta AI',         'company',   ARRAY['Facebook AI','FAIR','Meta','Meta Research','FAIR Research'],      true, 'manual'),
  ('Microsoft',       'company',   ARRAY['Microsoft Research','MSR','Azure AI','Microsoft AI'],             true, 'manual'),
  ('Hugging Face',    'company',   ARRAY['HuggingFace','huggingface','hf','Huggingface Inc'],               true, 'manual'),
  ('Mistral AI',      'company',   ARRAY['Mistral','mistral','MistralAI'],                                  true, 'manual'),
  ('xAI',             'company',   ARRAY['x.ai','xai','Elon Musk AI'],                                     true, 'manual'),
  ('Cohere',          'company',   ARRAY['cohere','Cohere Inc'],                                            true, 'manual'),
  ('arXiv',           'platform',  ARRAY['arxiv','arxiv.org','ArXiv','ar5iv'],                              true, 'manual'),
  ('GitHub',          'platform',  ARRAY['github','github.com','Github'],                                   true, 'manual'),
  ('Hugging Face Hub','platform',  ARRAY['hf hub','huggingface hub','HF Hub'],                              true, 'manual'),
  ('GPT-4',           'model',     ARRAY['gpt4','GPT4','gpt-4-turbo','gpt-4o','ChatGPT-4','gpt-4-vision'], true, 'manual'),
  ('Claude 3',        'model',     ARRAY['claude-3','Claude3','claude-opus','claude-sonnet','claude-haiku'],true, 'manual'),
  ('Llama',           'model',     ARRAY['llama','LLaMA','Llama 2','Llama 3','meta-llama'],                 true, 'manual'),
  ('Gemini',          'model',     ARRAY['gemini','Gemini Pro','Gemini Ultra','Gemini 1.5'],                true, 'manual')
ON CONFLICT (canonical_name) DO NOTHING;

COMMENT ON TABLE public.entity_registry IS
  'Canonical entity resolution for Signal Engine V2.
   All entity mentions from observations resolve to a canonical_name here.
   Supports external identifiers: DOI, arXiv, GitHub, Crunchbase, OpenAlex, Semantic Scholar.';
