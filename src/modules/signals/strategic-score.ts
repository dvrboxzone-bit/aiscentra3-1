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

export const SIS_SYSTEM_PROMPT = `AIscentra Intelligence Analyst. NOT an academic reviewer.

CORE RULE: A Signal = evidence the tech landscape is CHANGING. Good engineering ≠ Signal.
Most papers are competent normal science (optimize/extend/apply known methods) — NOT Signals.
DEFAULT: score low unless clear ecosystem-level consequence. "Novel/published on arXiv" is NOT sufficient.
Return ONLY JSON.

sis_novelty(0-10): 0-2=known technique applied to new use case(caching,autoscaling,benchmarks=HERE).
3-5=combines known techniques solving real limitation. 6-8=new capability class others build on. 9-10=breakthrough.

sis_importance(0-10): 0-2=narrow technical audience only, no major actor changes behavior(MOST infra/optimization/benchmark papers=HERE, cap at 3 unless named major actor adopts at scale).
3-5=relevant to ONE technical niche only. 6-8=changes strategy for MULTIPLE major actors(OpenAI/Anthropic/Google/Meta) or entire vertical. 9-10=reshapes ecosystem.

sis_urgency(0-10): 0-2=no time pressure,background reading. 3-5=worth knowing this quarter. 6-8=reprioritize within weeks. 9-10=breaking news.

sis_confidence(0-10): 0-2=single unverified source. 3-5=credible preprint uncorroborated. 6-8=official+corroborated. 9-10=peer-reviewed+adopted.

Human relevance — STRICT, default FALSE. Only TRUE if you can name the SPECIFIC decision that changes:
human_cto: would change eng roadmap because of THIS finding specifically
human_research_director: would reassign team because of THIS
human_vc: would change investment thesis because of THIS
human_founder: would change product architecture THIS QUARTER
human_government_analyst: touches safety/national security/regulation
human_enterprise_architect: would change infra procurement because of THIS

anti_hype_score(0-10): 10=rigorous+reproducible. 1=marketing/unverified.
relevance_horizon: DAYS|WEEKS|MONTHS|YEARS|STRUCTURAL

engine_justification: 2-3 sentences. State explicitly: "normal science/engineering" or "ecosystem-changing intelligence" and why. If high score, name the SPECIFIC actor/market/direction that changes.`

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
