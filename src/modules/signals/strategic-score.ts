/**
 * AIscentra — Signal Engine V2: Strategic Importance Score
 *
 * Four independent dimensions — not paper quality.
 * SIS measures strategic consequence for the AI ecosystem.
 *
 * SIS_FINAL = (N×0.25) + (I×0.35) + (U×0.20) + (C×0.20)
 * ≥ 6.0 → SIGNAL
 * 4.0–5.9 → WEAK_SIGNAL
 * < 4.0 → DISCARD/ARCHIVE
 */

import { z } from 'zod'
import type { StrategicImportanceScore, QualificationResult, HumanRelevanceFlags } from '@/types/database'
import { computeSISFinal, classifyBySIS } from '@/types/database'
import { V2_THRESHOLDS } from './pre-qualification'

// ── SIS LLM Output Schema ─────────────────────────────────────────────────────

export const SISOutputSchema = z.object({
  // Four independent dimensions
  sis_novelty: z.preprocess(
    v => Math.min(10, Math.max(0, Math.round(Number(v) || 0))),
    z.number().int().min(0).max(10),
  ),
  sis_importance: z.preprocess(
    v => Math.min(10, Math.max(0, Math.round(Number(v) || 0))),
    z.number().int().min(0).max(10),
  ),
  sis_urgency: z.preprocess(
    v => Math.min(10, Math.max(0, Math.round(Number(v) || 0))),
    z.number().int().min(0).max(10),
  ),
  sis_confidence: z.preprocess(
    v => Math.min(10, Math.max(0, Math.round(Number(v) || 0))),
    z.number().int().min(0).max(10),
  ),

  // Human relevance
  human_cto:                  z.union([z.boolean(), z.string().transform(s => s === 'true')]).default(false),
  human_research_director:    z.union([z.boolean(), z.string().transform(s => s === 'true')]).default(false),
  human_vc:                   z.union([z.boolean(), z.string().transform(s => s === 'true')]).default(false),
  human_founder:              z.union([z.boolean(), z.string().transform(s => s === 'true')]).default(false),
  human_government_analyst:   z.union([z.boolean(), z.string().transform(s => s === 'true')]).default(false),
  human_enterprise_architect: z.union([z.boolean(), z.string().transform(s => s === 'true')]).default(false),

  // Anti-hype
  anti_hype_score: z.preprocess(
    v => Math.min(10, Math.max(0, Math.round(Number(v) || 0))),
    z.number().int().min(0).max(10),
  ),
  anti_hype_flags: z.array(z.string()).default([]),

  // Relevance horizon
  relevance_horizon: z.enum(['DAYS', 'WEEKS', 'MONTHS', 'YEARS', 'STRUCTURAL']).default('MONTHS'),

  // Engine justification
  engine_justification: z.string().min(10).max(800),
}).passthrough()

export type SISOutput = z.infer<typeof SISOutputSchema>

// ── SIS system prompt ─────────────────────────────────────────────────────────

export const SIS_SYSTEM_PROMPT = `You are a strategic intelligence evaluator for AIscentra Observatory.
Evaluate the strategic importance of this AI ecosystem observation.
Return ONLY valid JSON. No markdown.

Score four dimensions (0-10 integers):

sis_novelty (0-10): Is this genuinely new?
  0-2=incremental improvement on known technique
  3-5=meaningful new approach within existing paradigm
  6-8=significant capability that did not exist before
  9-10=paradigm shift, categorically new

sis_importance (0-10): If adopted at scale, how much does this change the ecosystem?
  0-2=niche academic subfield only
  3-5=changes practice within one domain
  6-8=changes competitive dynamics across multiple actors
  9-10=reshapes entire AI landscape

sis_urgency (0-10): How time-sensitive is this for decision-makers?
  0-2=relevant in 2+ years
  3-5=relevant in 6-24 months
  6-8=relevant in 1-6 months
  9-10=decision-makers need this this week

sis_confidence (0-10): How well-evidenced is this?
  0-2=single source, no reproduction, speculative
  3-5=multiple secondary or one credible primary source
  6-8=official source + independent corroboration
  9-10=peer-reviewed + reproduced + adopted

Human relevance (true/false for each role):
human_cto: Would a CTO reprioritize engineering roadmap? (true for infrastructure, models, agents, cost optimization)
human_research_director: Would a Research Director reassign team? (true for novel benchmarks, new capabilities, research directions)
human_vc: Would a VC update investment thesis? (true for funding news, new labs, breakthrough capabilities)
human_founder: Would a Founder change architecture choices? (true for new APIs, infrastructure tools, cost changes)
human_government_analyst: Would a Government Analyst flag for policy review? (true for safety, regulation, national security AI)
human_enterprise_architect: Would an Enterprise Architect change infrastructure plans? (true for cloud AI, APIs, inference costs, serverless AI)
Be generous: if ANY professional in that role would reasonably care — answer true.

anti_hype_score (0-10): How credible is this? (10=highly credible, peer-reviewed, reproduced. 1=marketing press release)
anti_hype_flags: Array of concerns, e.g. ["single_source", "no_reproduction", "marketing_language"]

relevance_horizon: DAYS|WEEKS|MONTHS|YEARS|STRUCTURAL

engine_justification: 2-3 sentences explaining why this scores as it does. Be specific. Name the key factor.`

export function buildSISPrompt(title: string, content: string, sourceName: string, sourceType: string): string {
  return `SOURCE: ${sourceName} (${sourceType})
TITLE: ${title}
CONTENT: ${content.slice(0, 400)}

Evaluate strategic importance. Return JSON only.`
}

// ── Compute final SIS ─────────────────────────────────────────────────────────

export function computeSIS(raw: SISOutput): {
  sis:                   StrategicImportanceScore
  human_relevance:       HumanRelevanceFlags
  anti_hype_score:       number
  anti_hype_flags:       string[]
  relevance_horizon:     string
  engine_justification:  string
  decision:              QualificationResult
} {
  const sis: StrategicImportanceScore = {
    novelty:    raw.sis_novelty,
    importance: raw.sis_importance,
    urgency:    raw.sis_urgency,
    confidence: raw.sis_confidence,
    final:      0,
  }
  sis.final = parseFloat(computeSISFinal(sis).toFixed(2))

  const human_relevance: HumanRelevanceFlags = {
    cto:                  raw.human_cto,
    research_director:    raw.human_research_director,
    vc:                   raw.human_vc,
    founder:              raw.human_founder,
    government_analyst:   raw.human_government_analyst,
    enterprise_architect: raw.human_enterprise_architect,
    roles_yes_count:      [
      raw.human_cto, raw.human_research_director, raw.human_vc,
      raw.human_founder, raw.human_government_analyst, raw.human_enterprise_architect,
    ].filter(Boolean).length,
  }

  // Force DISCARD if no human would act on this
  let decision = classifyBySIS(sis.final)
  if (human_relevance.roles_yes_count < V2_THRESHOLDS.HUMAN_RELEVANCE_MIN) {
    decision = 'DISCARD'
  }
  // Cap at WEAK_SIGNAL if anti-hype is too low
  if (raw.anti_hype_score < V2_THRESHOLDS.ANTI_HYPE_MIN && decision === 'SIGNAL') {
    decision = 'WEAK_SIGNAL'
  }

  return {
    sis,
    human_relevance,
    anti_hype_score:      raw.anti_hype_score,
    anti_hype_flags:      raw.anti_hype_flags,
    relevance_horizon:    raw.relevance_horizon,
    engine_justification: raw.engine_justification,
    decision,
  }
}
