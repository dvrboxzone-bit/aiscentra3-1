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

  // ── Human Relevance as a MODIFIER, not a gate ────────────────────────────────
  // Strategic Importance Score remains the primary decision driver.
  // Human relevance adjusts sis.final by a bounded correction factor:
  //   0 roles  → -1.0  (no identifiable decision-maker acts on this)
  //   1 role   → -0.3  (narrow relevance)
  //   2 roles  → +0.0  (neutral — baseline expectation)
  //   3 roles  → +0.4  (broad relevance reinforces importance)
  //   4+ roles → +0.8  (strong cross-functional relevance)
  // This can move a borderline SIGNAL down to WEAK_SIGNAL, or a strong
  // Observation up — but a very high SIS_FINAL can still become a Signal
  // even at roles_yes_count = 0, since Strategic Importance dominates.
  const HUMAN_RELEVANCE_ADJUSTMENT: Record<number, number> = {
    0: -1.0,
    1: -0.3,
    2:  0.0,
    3:  0.4,
  }
  const roleAdjustment = HUMAN_RELEVANCE_ADJUSTMENT[human_relevance.roles_yes_count] ?? 0.8

  const adjustedFinal = parseFloat(
    Math.max(0, Math.min(10, sis.final + roleAdjustment)).toFixed(2)
  )
  sis.final = adjustedFinal

  // Anti-hype as a modifier too — reduces confidence-adjacent trust, not a hard gate
  let decision = classifyBySIS(sis.final)
  if (raw.anti_hype_score < V2_THRESHOLDS.ANTI_HYPE_MIN && decision === 'SIGNAL') {
    decision = 'WEAK_SIGNAL'  // Strong strategic score but weak evidence → demote, don't discard
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
