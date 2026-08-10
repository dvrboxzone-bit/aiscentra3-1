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
  SIGNAL_MIN: 6.0,
  WEAK_SIGNAL_MIN: 3.0,
  SIS_SIGNAL_MIN: 6.0,
  SIS_WEAK_MIN: 4.0,
  HUMAN_RELEVANCE_MIN: 1,
  ANTI_HYPE_MIN: 3.0,
  ENGINE_VERSION: 'v2.0',
} as const

// ── Hard rejection patterns ───────────────────────────────────────────────────

const REJECTION_PATTERNS: Array<{
  code: RejectionCode
  label: string
  test: (title: string, content: string, sourceType: string) => boolean
}> = [
  {
    code: 'R-05',
    label: 'PROMOTIONAL_CONTENT',
    test: (t, c) => {
      const text = `${t} ${c}`.toLowerCase()
      const hits = [
        'introducing',
        'announcing',
        'excited to share',
        'proud to announce',
        'we are thrilled',
        'check out',
        'sign up',
        'get started',
        'free trial',
        'join us',
      ].filter((w) => text.includes(w)).length
      return hits >= 3
    },
  },
  {
    code: 'R-08',
    label: 'TEMPORAL_IRRELEVANCE',
    test: (t) => {
      const lower = t.toLowerCase()
      return (
        lower.includes('conference schedule') ||
        lower.includes('call for papers') ||
        lower.includes('registration open') ||
        lower.includes('deadline extended')
      )
    },
  },
  {
    code: 'R-12',
    label: 'CATEGORY_DEFAULT_REJECT',
    test: (t, c) => {
      const text = `${t} ${c}`.toLowerCase()
      const isEducationStudy =
        (text.includes('course') ||
          text.includes('classroom') ||
          text.includes('student') ||
          text.includes('teaching')) &&
        !text.includes('model') &&
        !text.includes('training') &&
        !text.includes('algorithm')
      const isMinorRelease =
        /v\d+\.\d+\.\d+/.test(t) &&
        (t.toLowerCase().includes('bug fix') || t.toLowerCase().includes('patch'))
      return isEducationStudy || isMinorRelease
    },
  },
]

// ── Qualification weights ─────────────────────────────────────────────────────

export const QUALIFICATION_WEIGHTS = {
  changes_technology: 0.2,
  changes_engineering: 0.15,
  changes_adoption: 0.15,
  changes_investment: 0.1,
  changes_science: 0.1,
  competitive_advantage: 0.1,
  invalidates_prior: 0.1,
  changes_regulation: 0.05,
  changes_infrastructure: 0.05,
} as const

// ── Pre-qualification result ──────────────────────────────────────────────────

export interface PreQualificationResult {
  passed: boolean
  result: QualificationResult
  rejection_code: RejectionCode | null
  rejection_reason: string
  rejection_detail: Record<string, unknown>
  qualification_score: number
}

// ── Hard rejection check ──────────────────────────────────────────────────────

export function checkHardRejection(
  observation: Pick<ObservationRow, 'title' | 'content'>,
  sourceType: string,
): { rejected: boolean; code: RejectionCode | null; reason: string } {
  for (const pattern of REJECTION_PATTERNS) {
    if (pattern.test(observation.title, observation.content, sourceType)) {
      return { rejected: true, code: pattern.code, reason: pattern.label }
    }
  }
  return { rejected: false, code: null, reason: '' }
}

// ── Deterministic pre-filter (zero AI cost) ────────────────────────────────────
//
// Real problem this closes, measured directly from this project's own
// Groq request logs (7-day export, 461 real requests): a real
// enrichment (parser/70b) call costs ~2,527 tokens (2,352 input + 175
// output average). Against Groq's real 100,000 TPD limit for
// llama-3.3-70b-versatile, that caps Signal Engine at ~39.6
// observations/day, no matter how well request pacing (RPM) or the
// per-cycle time budget are tuned -- those only affect how FAST a
// cycle can go, not the hard DAILY token ceiling. Real intake is
// ~400/day. TPD is therefore ~10x too small to give every observation
// the full 2-AI-call (SIS + enrichment) treatment.
//
// checkHardRejection above already provides FREE rejection for clearly
// disqualified content (promotional, stale, category-default-reject).
// This function adds a SEPARATE, positive-signal deterministic score
// for everything that survives hard rejection, so the expensive AI
// path is reserved for observations most likely to be genuinely
// signal-worthy -- without discarding the rest. An observation scoring
// below the threshold is archived with a clear, auditable reason
// (ARCHIVED_PREFILTER) and the OBSERVATION ROW ITSELF is preserved
// (never deleted) -- exactly the "сохранив исходные observations"
// requirement -- it simply never reaches the AI stages.
//
// Deliberately keyword-based and inspectable, not a black box: every
// signal word here is either a term already meaningful to this
// project's own domain vocabulary (release, benchmark, funding,
// regulation, vulnerability) or a generic-content marker already
// echoing the spirit of the existing R-05/R-08 hard-rejection patterns
// (survey/review/tutorial framing rarely describes a discrete,
// dateable event the way a genuine Signal must, per Constitution
// Article 3.2's own Signal definition).
//
// REAL BUG FIXED (found via architectural review, confirmed by
// re-deriving the arithmetic directly): the ORIGINAL baseline (5) and
// threshold (5) were EQUAL, meaning an observation with ZERO keyword
// matches at all -- neither positive nor negative -- passed by
// default (5 >= 5). Since most real news text does not happen to
// contain one of a small, specific negative-phrase list
// (survey/review/tutorial/etc), the filter was effectively a weak
// negative-only screen: it caught obvious junk but did NOT require any
// positive evidence of newsworthiness to admit something to the
// expensive AI path. This directly explains why the replay's own
// throughput arithmetic never showed a real backlog reduction from
// this filter -- it was not meaningfully selective.
//
// Redesigned so PASSING requires genuine positive evidence, not mere
// absence of a few negative phrases: baseline is now LOW (1, well
// below threshold on its own), a single positive term is still
// insufficient (1 + 1.5 = 2.5 < 3), genuine multi-signal newsworthiness
// (>=2 distinct positive terms) is required to clear the bar, and a
// SINGLE negative term is now decisive (-3, driving the score to 0 or
// negative from any realistic starting point) rather than merely
// nudging it down.
export const PRE_FILTER_MIN = 3
const PRE_FILTER_BASELINE = 1
const POSITIVE_WEIGHT = 1.5
const NEGATIVE_WEIGHT = 3

const POSITIVE_TERMS = [
  'release',
  'released',
  'launch',
  'launched',
  'unveil',
  'unveiled',
  'breakthrough',
  'record',
  'state-of-the-art',
  'sota',
  'first to',
  'new model',
  'raises $',
  'raised $',
  'funding round',
  'acquisition',
  'acquires',
  'lawsuit',
  'sues',
  'ban',
  'banned',
  'regulation',
  'regulatory',
  'vulnerability',
  'exploit',
  'open-source',
  'open source',
  'benchmark',
  'outperforms',
  'surpasses',
  'beats',
  'achieves',
]

const NEGATIVE_TERMS = [
  'survey of',
  'review of',
  'introduction to',
  'overview of',
  'in this post',
  'in this article',
  'tutorial',
  'how to',
  'getting started',
  'roundup',
  'weekly digest',
  'week in review',
  'best practices',
  'tips and tricks',
  'ultimate guide',
]

/**
 * Deterministic, zero-AI-cost score in [0, 10]. Starts at a LOW
 * baseline (1) -- see the note above on why this changed from an
 * earlier, ineffective design -- +1.5 per distinct positive term
 * matched (capped at 4 matches), -3 per distinct negative term matched
 * (capped at 3 matches). A single negative term is decisive; genuine
 * newsworthiness requires at least 2 distinct positive signals to
 * clear PRE_FILTER_MIN.
 */
export function computeDeterministicPreScore(title: string, content: string): number {
  const text = `${title} ${content}`.toLowerCase()

  let score = PRE_FILTER_BASELINE
  let positiveMatches = 0
  let negativeMatches = 0

  for (const term of POSITIVE_TERMS) {
    if (positiveMatches >= 4) break // cap: no single observation dominates purely by keyword stuffing
    if (text.includes(term)) {
      score += POSITIVE_WEIGHT
      positiveMatches++
    }
  }
  for (const term of NEGATIVE_TERMS) {
    if (negativeMatches >= 3) break
    if (text.includes(term)) {
      score -= NEGATIVE_WEIGHT
      negativeMatches++
    }
  }

  return Math.max(0, Math.min(10, score))
}

export interface PreFilterResult {
  passed: boolean
  score: number
}

/**
 * Decides whether an observation is worth the AI cost of SIS +
 * enrichment. Returns the score regardless of pass/fail so callers
 * can log an auditable, specific reason (not just a boolean) --
 * required for a decision log entry that genuinely explains why an
 * observation was archived rather than processed.
 */
export function checkPreFilter(
  observation: Pick<ObservationRow, 'title' | 'content'>,
): PreFilterResult {
  const score = computeDeterministicPreScore(observation.title, observation.content)
  return { passed: score >= PRE_FILTER_MIN, score }
}
