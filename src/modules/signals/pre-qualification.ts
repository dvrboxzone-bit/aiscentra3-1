/**
 * AIscentra — Signal Engine V2: Pre-Qualification Gate
 *
 * Stage 1 of V2 pipeline. Runs BEFORE LLM enrichment.
 * Purpose: eliminate observations that should never become Signals.
 *
 * Two layers:
 * 1. Hard rejection rules (R-01 to R-12) — zero cost, keyword-based
 * 2. Weighted qualification scoring — cheap LLM call (~300 tokens)
 *
 * Output: QualificationResult + RejectionCode + scores
 */

import type { ObservationRow } from '@/modules/observations/queries'
import type { QualificationResult, RejectionCode } from '@/types/database'

// ── V2 Engine thresholds ───────────────────────────────────────────────────────

export const V2_THRESHOLDS = {
  SIGNAL_MIN:          6.0,   // qualification_score ≥ 6.0 → SIGNAL candidate
  WEAK_SIGNAL_MIN:     3.0,   // qualification_score ≥ 3.0 → WEAK_SIGNAL
  SIS_SIGNAL_MIN:      6.0,   // sis_final ≥ 6.0 → SIGNAL
  SIS_WEAK_MIN:        4.0,   // sis_final ≥ 4.0 → WEAK_SIGNAL
  HUMAN_RELEVANCE_MIN: 2,     // at least 2 roles must care
  ANTI_HYPE_MIN:       3.0,   // anti_hype_score ≥ 3.0 to proceed
  ENGINE_VERSION:      'v2.0',
} as const

// ── Hard rejection patterns (R-01 to R-12) ────────────────────────────────────

const REJECTION_PATTERNS: Array<{
  code:    RejectionCode
  label:   string
  test:    (title: string, content: string, sourceType: string) => boolean
}> = [
  {
    code:  'R-05',
    label: 'PROMOTIONAL_CONTENT',
    test:  (t, c) => {
      const text = `${t} ${c}`.toLowerCase()
      const promoWords = ['introducing', 'announcing', 'excited to share', 'proud to announce',
        'we are thrilled', 'check out', 'sign up', 'get started', 'free trial', 'join us']
      const hits = promoWords.filter(w => text.includes(w)).length
      return hits >= 3
    },
  },
  {
    code:  'R-08',
    label: 'TEMPORAL_IRRELEVANCE',
    test:  (t) => {
      const lower = t.toLowerCase()
      return lower.includes('conference schedule') ||
        lower.includes('call for papers') ||
        lower.includes('registration open') ||
        lower.includes('deadline extended')
    },
  },
  {
    code:  'R-12',
    label: 'CATEGORY_DEFAULT_REJECT',
    test:  (t, c) => {
      const text = `${t} ${c}`.toLowerCase()
      // Education studies without technical AI contribution
      const isEducationStudy = (text.includes('course') || text.includes('classroom') ||
        text.includes('student') || text.includes('teaching')) &&
        !text.includes('model') && !text.includes('training') && !text.includes('algorithm')
      // Minor version releases
      const isMinorRelease = /v\d+\.\d+\.\d+/.test(t) &&
        (t.toLowerCase().includes('bug fix') || t.toLowerCase().includes('patch'))
      return isEducationStudy || isMinorRelease
    },
  },
]

// ── Qualification weights ─────────────────────────────────────────────────────

export const QUALIFICATION_WEIGHTS = {
  changes_technology:     0.20,
  changes_engineering:    0.15,
  changes_adoption:       0.15,
  changes_investment:     0.10,
  changes_science:        0.10,
  competitive_advantage:  0.10,
  invalidates_prior:      0.10,
  changes_regulation:     0.05,
  changes_infrastructure: 0.05,
} as const

// ── Pre-qualification result ──────────────────────────────────────────────────

export interface PreQualificationResult {
  passed:             boolean
  result:             QualificationResult
  rejection_code:     RejectionCode | null
  rejection_reason:   string
  rejection_detail:   Record<string, unknown>
  qualification_score: number
}

// ── Hard rejection check ──────────────────────────────────────────────────────

export function checkHardRejection(
  observation: Pick<ObservationRow, 'title' | 'content'>,
  sourceType:  string,
): { rejected: boolean; code: RejectionCode | null; reason: string } {
  for (const pattern of REJECTION_PATTERNS) {
    if (pattern.test(observation.title, observation.content, sourceType)) {
      return {
        rejected: true,
        code:     pattern.code,
        reason:   pattern.label,
      }
    }
  }
  return { rejected: false, code: null, reason: '' }
}

// ── Category pre-assignment ───────────────────────────────────────────────────
// Runs before LLM — cheap keyword-based classification

const CATEGORY_SIGNALS: Array<{ category: string; keywords: string[] }> = [
  { category: 'REGULATION',      keywords: ['regulation', 'law', 'policy', 'governance', 'eu ai act', 'gdpr', 'compliance', 'legal', 'government'] },
  { category: 'FUNDING',         keywords: ['funding', 'investment', 'raised', 'series a', 'series b', 'venture', 'valuation', 'acquisition', 'merger'] },
  { category: 'MODELS',          keywords: ['model', 'llm', 'language model', 'gpt', 'claude', 'gemini', 'llama', 'mistral', 'weights', 'checkpoint'] },
  { category: 'AGENTS',          keywords: ['agent', 'agentic', 'autonomous', 'multi-agent', 'workflow automation', 'tool use'] },
  { category: 'INFRASTRUCTURE',  keywords: ['infrastructure', 'cloud', 'gpu', 'compute', 'datacenter', 'cluster', 'distributed'] },
  { category: 'HARDWARE',        keywords: ['chip', 'hardware', 'tpu', 'semiconductor', 'nvidia', 'amd', 'inference chip'] },
  { category: 'OPEN_SOURCE',     keywords: ['open source', 'open-source', 'open weight', 'apache', 'mit license', 'released weights'] },
  { category: 'COMPANIES',       keywords: ['company', 'startup', 'lab', 'organization', 'team', 'partnership', 'collaboration'] },
  { category: 'RESEARCH',        keywords: ['paper', 'arxiv', 'research', 'study', 'benchmark', 'dataset', 'evaluation'] },
]

export function preAssignCategoryV2(title: string, content: string): string {
  const text = `${title} ${content.slice(0, 500)}`.toLowerCase()
  for (const { category, keywords } of CATEGORY_SIGNALS) {
    if (keywords.some(kw => text.includes(kw))) return category
  }
  return 'RESEARCH'
}
