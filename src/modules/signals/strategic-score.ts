/**
 * AIscentra — Signal Engine V2: Strategic Importance Score
 *
 * Pipeline order (critical):
 *   Publication → Engine Classification (deterministic) → LLM Analysis → Deterministic Rules
 *
 * The LLM NEVER classifies publication type (survey/benchmark/etc).
 * The Engine classifies type from title/content BEFORE calling the LLM.
 * The LLM only scores strategic dimensions and identifies event_type (a semantic
 * judgment about the NATURE of the intelligence, not the publication format).
 *
 * Every decision carries a rule_trace — a machine-readable list of which
 * deterministic rules fired, separate from engine_justification (human text).
 */

import { z } from 'zod'
import type { StrategicImportanceScore, QualificationResult, HumanRelevanceFlags } from '@/types/database'
import { computeSISFinal, classifyBySIS } from '@/types/database'
import { V2_THRESHOLDS } from './pre-qualification'
import {
  classifyPublicationType,
  applyPublicationTypeCaps,
  type PublicationClassification,
} from './publication-classifier'

// ── SIS LLM Output Schema ─────────────────────────────────────────────────────
// Note: NO publication-type fields here. That classification happens in the
// Engine before this schema is even used to build the prompt.

export const SISOutputSchema = z.object({
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

  human_cto:                  z.union([z.boolean(), z.string().transform(s => s === 'true')]).default(false),
  human_research_director:    z.union([z.boolean(), z.string().transform(s => s === 'true')]).default(false),
  human_vc:                   z.union([z.boolean(), z.string().transform(s => s === 'true')]).default(false),
  human_founder:              z.union([z.boolean(), z.string().transform(s => s === 'true')]).default(false),
  human_government_analyst:   z.union([z.boolean(), z.string().transform(s => s === 'true')]).default(false),
  human_enterprise_architect: z.union([z.boolean(), z.string().transform(s => s === 'true')]).default(false),

  anti_hype_score: z.preprocess(
    v => Math.min(10, Math.max(0, Math.round(Number(v) || 0))),
    z.number().int().min(0).max(10),
  ),
  anti_hype_flags: z.array(z.string()).default([]),

  relevance_horizon: z.enum(['DAYS', 'WEEKS', 'MONTHS', 'YEARS', 'STRUCTURAL']).default('MONTHS'),

  event_type: z.enum([
    'DISCRETE_EVENT',
    'EMERGING_TREND',
    'ECOSYSTEM_CONSOLIDATION',
    'TECHNOLOGY_MATURITY',
    'DIRECTION_CONFIRMATION',
    'INDUSTRY_MOVEMENT',
  ]).default('DISCRETE_EVENT'),

  engine_justification: z.string().min(10).max(800),
}).passthrough()

export type SISOutput = z.infer<typeof SISOutputSchema>

// ── SIS system prompt ──────────────────────────────────────────────────────────

export const SIS_SYSTEM_PROMPT = `AIscentra Intelligence Analyst. NOT an academic reviewer.

CORE RULE: A Signal = evidence the tech landscape is CHANGING. Good engineering != Signal.
Most papers are competent normal science (optimize/extend/apply known methods) — NOT Signals.
DEFAULT: score low unless clear ecosystem-level consequence. Return ONLY JSON.

sis_novelty(0-10): 0-2=known technique applied to new use case. 3-5=combines known techniques solving real limitation.
6-8=new capability class others build on. 9-10=breakthrough.

sis_importance(0-10): 0-2=narrow technical audience only, no major actor changes behavior.
3-5=relevant to ONE technical niche only. 6-8=changes strategy for MULTIPLE major actors(OpenAI/Anthropic/Google/Meta) or entire vertical. 9-10=reshapes ecosystem.

sis_urgency(0-10): 0-2=no time pressure. 3-5=worth knowing this quarter. 6-8=reprioritize within weeks. 9-10=breaking news.

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

event_type: classify the NATURE of this intelligence (not the publication format):
DISCRETE_EVENT(default)=specific confirmed capability/event.
EMERGING_TREND=early pattern, not yet confirmed direction.
ECOSYSTEM_CONSOLIDATION=market/actor consolidation (mergers, standardization).
TECHNOLOGY_MATURITY=technique moving from research to production readiness.
DIRECTION_CONFIRMATION=confirms a previously hypothesized direction.
INDUSTRY_MOVEMENT=organizational movement (talent, partnerships, lab formation).

engine_justification: 2-3 sentences. State explicitly whether this is "normal science/engineering"
or genuine "ecosystem-changing intelligence" and why. If high score, name the SPECIFIC
actor/market/direction that changes.`

export function buildSISPrompt(title: string, content: string, sourceName: string, sourceType: string): string {
  return `SOURCE: ${sourceName} (${sourceType})
TITLE: ${title}
CONTENT: ${content.slice(0, 400)}

Evaluate strategic importance. Return JSON only.`
}

export type RuleTraceEntry = string

// ── Compute final SIS ─────────────────────────────────────────────────────────

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
  publication_type:        PublicationClassification
  rule_trace:              RuleTraceEntry[]
} {
  const ruleTrace: RuleTraceEntry[] = []

  // ── Step 1: Engine Classification (deterministic, BEFORE any LLM-derived logic) ──
  const publicationClass = classifyPublicationType(title, content)
  if (publicationClass.matchedPatterns.length > 0) {
    ruleTrace.push(...publicationClass.matchedPatterns.map(p => `classification:${p}`))
  }

  // ── Step 2: Apply deterministic caps based on Engine classification ─────────
  const caps = applyPublicationTypeCaps(publicationClass, raw.sis_novelty, raw.sis_importance)
  ruleTrace.push(...caps.rulesTriggered)

  // ── Step 3: Compute SIS_FINAL from (possibly capped) dimensions ──────────────
  const sis: StrategicImportanceScore = {
    novelty:    caps.novelty,
    importance: caps.importance,
    urgency:    raw.sis_urgency,
    confidence: raw.sis_confidence,
    final:      0,
  }
  sis.final = parseFloat(computeSISFinal(sis).toFixed(2))

  // ── Step 4: Human Relevance — modifier, not gate ─────────────────────────────
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

  const HUMAN_RELEVANCE_ADJUSTMENT: Record<number, number> = { 0: -1.0, 1: -0.3, 2: 0.0, 3: 0.4 }
  const roleAdjustment = HUMAN_RELEVANCE_ADJUSTMENT[human_relevance.roles_yes_count] ?? 0.8
  if (roleAdjustment !== 0) ruleTrace.push('human_relevance_modifier')

  sis.final = parseFloat(Math.max(0, Math.min(10, sis.final + roleAdjustment)).toFixed(2))

  // ── Step 5: Classify decision from SIS_FINAL ─────────────────────────────────
  let decision = classifyBySIS(sis.final)

  // ── Step 6: Anti-hype modifier — demotes SIGNAL→WEAK_SIGNAL only ────────────
  if (raw.anti_hype_score < V2_THRESHOLDS.ANTI_HYPE_MIN && decision === 'SIGNAL') {
    decision = 'WEAK_SIGNAL'
    ruleTrace.push('anti_hype_modifier')
  }

  // ── Step 7: Event-type promotion — PROMOTION ONLY, never demotes SIGNAL ──────
  const isWeakSignalEventType = raw.event_type !== 'DISCRETE_EVENT'
  if (isWeakSignalEventType && decision === 'DISCARD' && sis.final >= 2.5) {
    decision = 'WEAK_SIGNAL'
    ruleTrace.push('event_type_promotion')
  }

  // ── Build transparent, human-readable justification ──────────────────────────
  const overrideNotes: string[] = []
  if (caps.noveltyCapped)    overrideNotes.push(`NOVELTY CAP: publication classified as ${publicationClass.type} — novelty capped`)
  if (caps.importanceCapped) overrideNotes.push(`IMPORTANCE CAP: publication classified as ${publicationClass.type} — importance capped`)
  if (ruleTrace.includes('event_type_promotion')) {
    overrideNotes.push(`EVENT TYPE: classified as ${raw.event_type} — promoted from DISCARD to Weak Signal`)
  }

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
    publication_type:     publicationClass,
    rule_trace:           ruleTrace,
  }
}
