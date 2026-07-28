-- ============================================================
-- Migration: 20260728000011_add_rule_trace
-- Signal Engine V2 — Rule Trace (machine-readable audit)
--
-- Separates:
--   engine_justification = human-readable explanation
--   rule_trace            = machine-readable list of rules that fired
-- ============================================================

ALTER TABLE public.signal_decision_log
  ADD COLUMN IF NOT EXISTS rule_trace JSONB NOT NULL DEFAULT '[]';

COMMENT ON COLUMN public.signal_decision_log.rule_trace IS
  'Machine-readable list of deterministic rules that fired for this decision.
   Example: ["classification:publication_type:survey", "survey_novelty_cap", "human_relevance_modifier"]
   Empty array [] if no deterministic rules fired.
   Separate from engine_justification (human-readable text) — this is data, not prose.';
