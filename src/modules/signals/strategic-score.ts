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

// ── Survey/Tutorial/Review Detection ──────────────────────────────────────────
// Deterministic rule — NOT dependent on LLM judgment.
// Survey/Tutorial/Review papers systematize existing knowledge; they do not
// create new technology. Novelty is capped regardless of what the LLM scored,
// UNLESS the title/content clearly indicates a new architecture/standard/protocol
// is being introduced alongside the review.

const SURVEY_PATTERNS = [
  /\bsurvey\b/i,
  /\btutorial\b/i,
  /\breview\b/i,
  /\bsystematic review\b/i,
  /\bstate.of.the.art review\b/i,
  /\bliterature review\b/i,
  /\ba (?:comprehensive |systematic )?(?:overview|survey) (?:of|on)\b/i,
]

// ── Weak Signal event-type classification ─────────────────────────────────────
// Weak Signal is a distinct intelligence class, not merely "SIS between 4-6".
// These event types qualify as Weak Signal even at lower/higher SIS scores
// because they represent a DIFFERENT KIND of intelligence — directional evidence
// rather than a discrete capability change.

export type WeakSignalEventType =
  | 'EMERGING_TREND'          // early pattern across multiple observations
  | 'ECOSYSTEM_CONSOLIDATION' // market/actor consolidation signal
  | 'TECHNOLOGY_MATURITY'     // technique moving from research to production readiness
  | 'DIRECTION_CONFIRMATION'  // confirms a previously hypothesized direction
  | 'INDUSTRY_MOVEMENT'       // actor/organizational movement (talent, partnerships)
  | null

const WEAK_SIGNAL_EVENT_PATTERNS: Record<Exclude<WeakSignalEventType, null>, RegExp[]> = {
  EMERGING_TREND: [
    /emerging trend/i, /early sign(?:s|al)? of/i, /growing (?:interest|adoption) in/i,
  ],
  ECOSYSTEM_CONSOLIDATION: [
    /consolidat/i, /merger|acquisition/i, /industry (?:is )?converging/i,
  ],
  TECHNOLOGY_MATURITY: [
    /production.ready/i, /moving from research to/i, /maturing technology/i,
    /widely adopted/i, /industry standard/i,
  ],
  DIRECTION_CONFIRMATION: [
    /confirms? (?:the )?(?:hypothesis|direction|trend)/i, /validates? (?:prior|earlier) work/i,
  ],
  INDUSTRY_MOVEMENT: [
    /joins? (?:openai|anthropic|google|meta|microsoft)/i, /partnership between/i,
    /talent (?:move|shift)/i, /key researcher/i,
  ],
}

export function classifyWeakSignalEventType(justificationText: string): WeakSignalEventType {
  for (const [eventType, patterns] of Object.entries(WEAK_SIGNAL_EVENT_PATTERNS)) {
    if (patterns.some(p => p.test(justificationText))) {
      return eventType as WeakSignalEventType
    }
  }
  return null
}

const NEW_CONTRIBUTION_OVERRIDE_PATTERNS = [
  /\bnew architecture\b/i,
  /\bnew protocol\b/i,
  /\bnew standard\b/i,
  /\bnew framework\b/i,
  /\bnovel architecture\b/i,
  /\bwe propose\b/i,
  /\bwe introduce\b/i,
  /\bwe present a new\b/i,
]

const SURVEY_NOVELTY_CAP = 3
const NORMAL_SCIENCE_IMPORTANCE_CAP = 3

// Patterns indicating "normal science" — incremental engineering, not ecosystem change.
// Checked against the LLM's own justification text (self-disclosure signal).
const NORMAL_SCIENCE_JUSTIFICATION_PATTERNS = [
  /combines? known techniques?/i,
  /incremental improvement/i,
  /\boptimization\b/i,
  /\bbenchmark\b/i,
  /\bsurvey\b/i,
  /\btutorial\b/i,
  /\breview\b/i,
  /does not introduce a new capability/i,
  /not a breakthrough/i,
  /applies? (?:known|existing) (?:technique|method)/i,
]

// Exceptions — if justification also claims genuine ecosystem consequence,
// do not cap even if normal-science language is present.
const ECOSYSTEM_CHANGE_OVERRIDE_PATTERNS = [
  /reshapes? (?:the )?(?:entire )?(?:ai )?(?:ecosystem|landscape)/i,
  /changes? strategy for multiple major actors/i,
  /new capability class/i,
  /paradigm shift/i,
  /redefines? what (?:ai )?systems? can do/i,
]

export function applyNormalScienceImportanceCap(
  justificationText: string,
  rawImportance:     number,
): { importance: number; capped: boolean; reason: string | null } {
  const isNormalScience = NORMAL_SCIENCE_JUSTIFICATION_PATTERNS.some(p => p.test(justificationText))
  if (!isNormalScience) {
    return { importance: rawImportance, capped: false, reason: null }
  }

  const hasEcosystemOverride = ECOSYSTEM_CHANGE_OVERRIDE_PATTERNS.some(p => p.test(justificationText))
  if (hasEcosystemOverride) {
    return {
      importance: rawImportance,
      capped:     false,
      reason:     'Normal-science language present but justification also claims genuine ecosystem consequence — cap not applied',
    }
  }

  const capped = Math.min(rawImportance, NORMAL_SCIENCE_IMPORTANCE_CAP)
  return {
    importance: capped,
    capped:     capped < rawImportance,
    reason:     capped < rawImportance
      ? `Justification self-describes as normal science/incremental work — importance capped at ${NORMAL_SCIENCE_IMPORTANCE_CAP}`
      : null,
  }
}

export function isSurveyOrReview(title: string, content: string): boolean {
  const text = `${title} ${content.slice(0, 300)}`
  return SURVEY_PATTERNS.some(p => p.test(text))
}

export function hasNewContributionOverride(title: string, content: string): boolean {
  const text = `${title} ${content.slice(0, 500)}`
  return NEW_CONTRIBUTION_OVERRIDE_PATTERNS.some(p => p.test(text))
}

export function applySurveyNoveltyCap(
  title:        string,
  content:      string,
  rawNovelty:   number,
): { novelty: number; capped: boolean; reason: string | null } {
  const isSurvey = isSurveyOrReview(title, content)
  if (!isSurvey) {
    return { novelty: rawNovelty, capped: false, reason: null }
  }

  const hasOverride = hasNewContributionOverride(title, content)
  if (hasOverride) {
    return {
      novelty: rawNovelty,
      capped:  false,
      reason:  'Survey/review detected but introduces new architecture/protocol/standard — cap not applied',
    }
  }

  const capped = Math.min(rawNovelty, SURVEY_NOVELTY_CAP)
  return {
    novelty: capped,
    capped:  capped < rawNovelty,
    reason:  capped < rawNovelty
      ? `Survey/Tutorial/Review detected — novelty capped at ${SURVEY_NOVELTY_CAP} (systematizes existing knowledge, does not create new technology)`
      : null,
  }
}

export function computeSIS(
  raw:     SISOutput,
  title:   string = '',
  content: string = '',
): {
  sis:                     StrategicImportanceScore
  human_relevance:         HumanRelevanceFlags
  anti_hype_score:         number
  anti_hype_flags:         string[]
  relevance_horizon:       string
  engine_justification:    string
  decision:                QualificationResult
  novelty_cap_applied:     boolean
  novelty_cap_reason:      string | null
  importance_cap_applied:  boolean
  importance_cap_reason:   string | null
  weak_signal_event_type:  WeakSignalEventType
} {
  // ── Deterministic Survey/Tutorial/Review novelty cap ─────────────────────
  // Applied BEFORE SIS_FINAL computation — not dependent on LLM self-assessment.
  const noveltyCapResult = applySurveyNoveltyCap(title, content, raw.sis_novelty)

  // ── Deterministic Normal-Science importance cap ──────────────────────────
  // Checks the LLM's OWN justification for self-disclosed normal-science language.
  const importanceCapResult = applyNormalScienceImportanceCap(raw.engine_justification, raw.sis_importance)

  const sis: StrategicImportanceScore = {
    novelty:    noveltyCapResult.novelty,
    importance: importanceCapResult.importance,
    urgency:    raw.sis_urgency,
    confidence: raw.sis_confidence,
    final:      0,
  }
  sis.final = parseFloat(computeSISFinal(sis).toFixed(2))

  // ── Weak Signal event-type classification ────────────────────────────────
  // Weak Signal is a distinct intelligence class — not merely a numeric band.
  const weakSignalEventType = classifyWeakSignalEventType(raw.engine_justification)

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

  // Anti-hype: strong strategic score but weak evidence → demote, don't discard
  if (raw.anti_hype_score < V2_THRESHOLDS.ANTI_HYPE_MIN && decision === 'SIGNAL') {
    decision = 'WEAK_SIGNAL'
  }

  // Weak Signal event types: these represent directional intelligence, not discrete
  // capability change. They qualify as WEAK_SIGNAL even outside the normal SIS band —
  // both promoting a DISCARD-range observation up, and preventing over-promotion to SIGNAL.
  if (weakSignalEventType !== null) {
    if (decision === 'DISCARD' && sis.final >= 2.5) {
      // Directional evidence worth monitoring even at modest SIS
      decision = 'WEAK_SIGNAL'
    } else if (decision === 'SIGNAL') {
      // Trend/consolidation/movement signals are inherently provisional —
      // they describe direction, not a confirmed discrete event. Treat as Weak
      // until corroborated by further observations.
      decision = 'WEAK_SIGNAL'
    }
  }

  // Build transparent engine justification with all overrides disclosed
  const overrideNotes: string[] = []
  if (noveltyCapResult.capped)    overrideNotes.push(`NOVELTY CAP: ${noveltyCapResult.reason}`)
  if (importanceCapResult.capped) overrideNotes.push(`IMPORTANCE CAP: ${importanceCapResult.reason}`)
  if (weakSignalEventType)        overrideNotes.push(`EVENT TYPE: classified as ${weakSignalEventType} — treated as directional Weak Signal`)

  const finalJustification = overrideNotes.length > 0
    ? `${raw.engine_justification} [ENGINE OVERRIDES: ${overrideNotes.join(' | ')}]`
    : raw.engine_justification

  return {
    sis,
    human_relevance,
    anti_hype_score:      raw.anti_hype_score,
    anti_hype_flags:      raw.anti_hype_flags,
    relevance_horizon:    raw.relevance_horizon,
    engine_justification: finalJustification,
    decision,
    novelty_cap_applied:    noveltyCapResult.capped,
    novelty_cap_reason:     noveltyCapResult.reason,
    importance_cap_applied: importanceCapResult.capped,
    importance_cap_reason:  importanceCapResult.reason,
    weak_signal_event_type: weakSignalEventType,
  }
}
