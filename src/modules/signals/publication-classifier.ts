/**
 * AIscentra — Signal Engine V2: Publication Type Classifier
 *
 * Fully deterministic. Runs BEFORE LLM analysis.
 * Classifies publication type from title, source metadata, and content —
 * never from LLM judgment. The LLM analyzes content; the Engine classifies
 * what KIND of publication it is.
 *
 * Pipeline order:
 *   Publication → Engine Classification → LLM Analysis → Deterministic Rules
 */

export type PublicationType =
  | 'SURVEY'
  | 'TUTORIAL'
  | 'REVIEW'
  | 'LITERATURE_REVIEW'
  | 'STATE_OF_THE_ART_REVIEW'
  | 'BENCHMARK'
  | 'DATASET'
  | 'FRAMEWORK'
  | 'METHOD'
  | 'IMPLEMENTATION'
  | 'STANDARD_RESEARCH'   // default — original research contribution

export interface PublicationClassification {
  type:               PublicationType
  isReviewClass:      boolean   // SURVEY|TUTORIAL|REVIEW|LITERATURE_REVIEW|STATE_OF_THE_ART_REVIEW
  isEngineeringClass: boolean   // BENCHMARK|FRAMEWORK|IMPLEMENTATION (applied engineering, not novel science)
  hasNewContribution: boolean   // signals new architecture/protocol/standard despite being review-class
  matchedPatterns:    string[]  // which patterns triggered — for rule_trace
}

// ── Review-class patterns (title-based, deterministic) ────────────────────────

const REVIEW_PATTERNS: Array<{ type: PublicationType; patterns: RegExp[] }> = [
  { type: 'LITERATURE_REVIEW',        patterns: [/\bliterature review\b/i] },
  { type: 'STATE_OF_THE_ART_REVIEW',  patterns: [/\bstate.of.the.art review\b/i, /\bsota review\b/i] },
  { type: 'SURVEY',                   patterns: [/\bsurvey\b/i, /\ba (?:comprehensive |systematic )?(?:overview|survey) (?:of|on)\b/i] },
  { type: 'TUTORIAL',                 patterns: [/\btutorial\b/i] },
  { type: 'REVIEW',                   patterns: [/\bsystematic review\b/i, /\breview\b/i] },
]

// ── Engineering-class patterns (applied work, not novel science by default) ──

const ENGINEERING_PATTERNS: Array<{ type: PublicationType; patterns: RegExp[] }> = [
  { type: 'BENCHMARK',      patterns: [/\bbench(?:mark)?\b/i, /\bbenchmarking\b/i, /\bevaluation suite\b/i] },
  { type: 'DATASET',        patterns: [/\bdataset\b/i, /\bcorpus\b/i, /\bdata collection\b/i] },
  { type: 'FRAMEWORK',      patterns: [/\bframework\b/i, /\btoolkit\b/i, /\bplatform\b/i] },
  { type: 'IMPLEMENTATION', patterns: [/\bimplementation\b/i, /\blibrary\b/i, /\bopen.source (?:tool|release)\b/i] },
]

// ── New contribution override — even review-class papers can carry genuine novelty ─

const NEW_CONTRIBUTION_PATTERNS = [
  /\bnew architecture\b/i,
  /\bnew protocol\b/i,
  /\bnew standard\b/i,
  /\bnovel architecture\b/i,
  /\bwe propose\b/i,
  /\bwe introduce\b/i,
  /\bwe present a new\b/i,
  /\bnovel framework\b/i,
]

// ── Classifier ─────────────────────────────────────────────────────────────────

export function classifyPublicationType(
  title:   string,
  content: string,
): PublicationClassification {
  const titleText   = title
  const contentText = content.slice(0, 500)
  const combined    = `${titleText} ${contentText}`

  const matchedPatterns: string[] = []
  let type: PublicationType = 'STANDARD_RESEARCH'

  // Check review-class first (higher priority — these get novelty cap)
  for (const { type: t, patterns } of REVIEW_PATTERNS) {
    for (const p of patterns) {
      if (p.test(combined)) {
        type = t
        matchedPatterns.push(`publication_type:${t.toLowerCase()}`)
        break
      }
    }
    if (type !== 'STANDARD_RESEARCH') break
  }

  // If not review-class, check engineering-class
  if (type === 'STANDARD_RESEARCH') {
    for (const { type: t, patterns } of ENGINEERING_PATTERNS) {
      for (const p of patterns) {
        if (p.test(combined)) {
          type = t
          matchedPatterns.push(`publication_type:${t.toLowerCase()}`)
          break
        }
      }
      if (type !== 'STANDARD_RESEARCH') break
    }
  }

  const isReviewClass = ['SURVEY', 'TUTORIAL', 'REVIEW', 'LITERATURE_REVIEW', 'STATE_OF_THE_ART_REVIEW']
    .includes(type)
  const isEngineeringClass = ['BENCHMARK', 'DATASET', 'FRAMEWORK', 'IMPLEMENTATION']
    .includes(type)

  const hasNewContribution = NEW_CONTRIBUTION_PATTERNS.some(p => p.test(`${titleText} ${content.slice(0, 800)}`))
  if (hasNewContribution) matchedPatterns.push('new_contribution_override')

  return {
    type,
    isReviewClass,
    isEngineeringClass,
    hasNewContribution,
    matchedPatterns,
  }
}

// ── Deterministic caps based on classification (not LLM judgment) ─────────────

export const SURVEY_NOVELTY_CAP           = 3
export const NORMAL_SCIENCE_IMPORTANCE_CAP = 3

export function applyPublicationTypeCaps(
  classification: PublicationClassification,
  rawNovelty:     number,
  rawImportance:  number,
): {
  novelty:            number
  importance:         number
  noveltyCapped:      boolean
  importanceCapped:   boolean
  rulesTriggered:     string[]
} {
  const rulesTriggered: string[] = []
  let novelty    = rawNovelty
  let importance = rawImportance
  let noveltyCapped    = false
  let importanceCapped = false

  // Review-class → novelty cap, UNLESS genuine new contribution present
  if (classification.isReviewClass && !classification.hasNewContribution) {
    const capped = Math.min(rawNovelty, SURVEY_NOVELTY_CAP)
    if (capped < rawNovelty) {
      novelty = capped
      noveltyCapped = true
      rulesTriggered.push('survey_novelty_cap')
    }
  }

  // Engineering-class (benchmark/framework/implementation) → importance cap,
  // UNLESS genuine new contribution present
  if (classification.isEngineeringClass && !classification.hasNewContribution) {
    const capped = Math.min(rawImportance, NORMAL_SCIENCE_IMPORTANCE_CAP)
    if (capped < rawImportance) {
      importance = capped
      importanceCapped = true
      rulesTriggered.push('engineering_class_importance_cap')
    }
  }

  return { novelty, importance, noveltyCapped, importanceCapped, rulesTriggered }
}
