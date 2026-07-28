/**
 * AIscentra — Signal Engine V2: Pre-Qualification Gate
 *
 * Stage 1 of V2 pipeline. Runs BEFORE LLM enrichment.
 * Hard rejection rules R-01 to R-12 — zero AI cost.
 */
import type { ObservationRow } from '@/modules/observations/queries'
import type { QualificationResult, RejectionCode } from '@/types/database'

// ── V2 Engine thresholds ───────────────────────────────────────────────────────

export const V2_THRESHOLDS = {
  SIGNAL_MIN:          6.0,
  WEAK_SIGNAL_MIN:     3.0,
  SIS_SIGNAL_MIN:      6.0,
  SIS_WEAK_MIN:        4.0,
  HUMAN_RELEVANCE_MIN: 1,
  ANTI_HYPE_MIN:       3.0,
  ENGINE_VERSION:      'v2.0',
} as const

// ── Hard rejection patterns ───────────────────────────────────────────────────

const REJECTION_PATTERNS: Array<{
  code:  RejectionCode
  label: string
  test:  (title: string, content: string, sourceType: string) => boolean
}> = [
  {
    code:  'R-05',
    label: 'PROMOTIONAL_CONTENT',
    test:  (t, c) => {
      const text = `${t} ${c}`.toLowerCase()
      const hits = ['introducing', 'announcing', 'excited to share', 'proud to announce',
        'we are thrilled', 'check out', 'sign up', 'get started', 'free trial', 'join us']
        .filter(w => text.includes(w)).length
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
      const isEducationStudy = (text.includes('course') || text.includes('classroom') ||
        text.includes('student') || text.includes('teaching')) &&
        !text.includes('model') && !text.includes('training') && !text.includes('algorithm')
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
  passed:              boolean
  result:              QualificationResult
  rejection_code:      RejectionCode | null
  rejection_reason:    string
  rejection_detail:    Record<string, unknown>
  qualification_score: number
}

// ── Hard rejection check ──────────────────────────────────────────────────────

export function checkHardRejection(
  observation: Pick<ObservationRow, 'title' | 'content'>,
  sourceType:  string,
): { rejected: boolean; code: RejectionCode | null; reason: string } {
  for (const pattern of REJECTION_PATTERNS) {
    if (pattern.test(observation.title, observation.content, sourceType)) {
      return { rejected: true, code: pattern.code, reason: pattern.label }
    }
  }
  return { rejected: false, code: null, reason: '' }
}
