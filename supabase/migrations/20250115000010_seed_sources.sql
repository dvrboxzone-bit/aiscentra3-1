-- ============================================================
-- AIscentra Migration 010
-- Initial Source Registry
-- Reference: MVP Specification v1.0 — Approved Initial Sources
-- ============================================================
-- "Quality over quantity" — MVP Spec
-- Starting with 9 high-trust sources covering all signal categories

insert into public.sources (name, type, url, trust_score, check_interval_hours) values
  -- Tier 1: Official company channels (trust_score: 0.95)
  ('OpenAI Blog',       'company_blog', 'https://openai.com/blog',                    0.95, 4),
  ('Anthropic News',    'company_blog', 'https://www.anthropic.com/news',             0.95, 4),
  ('Google DeepMind',   'company_blog', 'https://deepmind.google/discover/blog/',     0.95, 4),
  ('Meta AI Blog',      'company_blog', 'https://ai.meta.com/blog/',                  0.90, 4),
  ('Mistral AI Blog',   'company_blog', 'https://mistral.ai/news/',                   0.90, 4),

  -- Tier 2: High-authority technical sources (trust_score: 0.85)
  ('Hugging Face Blog', 'technical',    'https://huggingface.co/blog',                0.85, 4),
  ('GitHub Blog AI',    'technical',    'https://github.blog',                        0.80, 6),

  -- Tier 3: Research sources (trust_score: 0.80)
  ('ArXiv CS.AI',       'research',     'https://arxiv.org/list/cs.AI/recent',       0.80, 8),
  ('ArXiv CS.LG',       'research',     'https://arxiv.org/list/cs.LG/recent',       0.80, 8)

on conflict (url) do nothing;

comment on table public.sources is
  'MVP initial sources. 9 sources covering Models, Research, Companies, Open Source. '
  'All have trust_score ≥ 0.5 (PQ-01 requirement). '
  'Add sources via admin interface, not migrations.';
