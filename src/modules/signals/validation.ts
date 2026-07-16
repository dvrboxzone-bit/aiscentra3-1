/**
 * AIscentra — Signal Validation Rules
 *
 * Implements VAL-01 through VAL-12 from Signal Scoring Specification v1.0, Section 10.
 * Runs after enrichment, before DRAFT → ACTIVE transition.
 */
import type { SignalCategory } from '@/types/database'

export interface ValidationInput {
  title: string
  description: string
  signal_score: number
  confidence_score: number
  category: SignalCategory
  observation_ids: string[]
  entities: { name: string; type: string }[]
}

export interface ValidationResult {
  valid: boolean
  flags: string[]           // Warning flags (ACTIVE with warning)
  rejectionReason?: string  // If set, signal must be REJECTED
  canRetry: boolean         // true = re-enrich; false = hard reject
}

// Terms that indicate hedging — forbidden in titles (VAL-09)
const HEDGING_TERMS = [
  'reportedly', 'possibly', 'allegedly', 'rumored', 'rumoured',
  'i think', 'we think', 'may have', 'might have', 'could have',
  'sources say', 'sources claim', 'unconfirmed',
]

// First-person starts forbidden in description (VAL-12)
const FIRST_PERSON_STARTS = ['I ', 'We ', 'Our ', "I'", "We'"]

export function validateSignal(input: ValidationInput): ValidationResult {
  const flags: string[] = []

  // VAL-01: title length 10–80 characters
  if (input.title.length < 10 || input.title.length > 80) {
    return {
      valid: false,
      flags: [],
      rejectionReason: `VAL-01: title length ${input.title.length} (required 10–80)`,
      canRetry: true,
    }
  }

  // VAL-02: description length 50–500 characters
  if (input.description.length < 50 || input.description.length > 500) {
    return {
      valid: false,
      flags: [],
      rejectionReason: `VAL-02: description length ${input.description.length} (required 50–500)`,
      canRetry: true,
    }
  }

  // VAL-03 & VAL-04: score range integrity (system error if invalid)
  if (!Number.isInteger(input.signal_score) || input.signal_score < 0 || input.signal_score > 100) {
    return {
      valid: false,
      flags: [],
      rejectionReason: `VAL-03: signal_score ${input.signal_score} out of range (system error)`,
      canRetry: false,
    }
  }
  if (!Number.isInteger(input.confidence_score) || input.confidence_score < 0 || input.confidence_score > 100) {
    return {
      valid: false,
      flags: [],
      rejectionReason: `VAL-04: confidence_score ${input.confidence_score} out of range (system error)`,
      canRetry: false,
    }
  }

  // VAL-05: confidence hard floor — below 25 is rejected (not retried)
  if (input.confidence_score < 25) {
    return {
      valid: false,
      flags: [],
      rejectionReason: `VAL-05: confidence_score ${input.confidence_score} below floor (minimum 25)`,
      canRetry: false,
    }
  }

  // VAL-06: signal score minimum threshold
  if (input.signal_score < 30) {
    return {
      valid: false,
      flags: [],
      rejectionReason: `VAL-06: signal_score ${input.signal_score} below threshold (minimum 30)`,
      canRetry: false,
    }
  }

  // VAL-07: category must be one of nine approved values
  const VALID_CATEGORIES: SignalCategory[] = [
    'RESEARCH', 'MODELS', 'COMPANIES', 'INFRASTRUCTURE',
    'OPEN_SOURCE', 'FUNDING', 'REGULATION', 'AGENTS', 'HARDWARE',
  ]
  if (!VALID_CATEGORIES.includes(input.category)) {
    return {
      valid: false,
      flags: [],
      rejectionReason: `VAL-07: invalid category "${input.category}"`,
      canRetry: true,
    }
  }

  // VAL-08: at least one observation linked
  if (input.observation_ids.length === 0) {
    return {
      valid: false,
      flags: [],
      rejectionReason: 'VAL-08: no observation_ids linked (orphan signal)',
      canRetry: false,
    }
  }

  // VAL-09: title contains no hedging terms
  const lowerTitle = input.title.toLowerCase()
  const foundHedge = HEDGING_TERMS.find((term) => lowerTitle.includes(term))
  if (foundHedge) {
    return {
      valid: false,
      flags: [],
      rejectionReason: `VAL-09: title contains hedging term "${foundHedge}"`,
      canRetry: true,
    }
  }

  // VAL-10: at least one entity extracted (warn, don't reject)
  if (input.entities.length === 0) {
    flags.push('VAL-10: no entities extracted — signal flagged for manual review')
  }

  // VAL-11: title not identical to any recent signal (handled at dedup layer)
  // Checked in deduplication before enrichment — if it reaches here, it passed

  // VAL-12: description must not begin with first-person
  const startsFirstPerson = FIRST_PERSON_STARTS.some((start) =>
    input.description.startsWith(start),
  )
  if (startsFirstPerson) {
    return {
      valid: false,
      flags: [],
      rejectionReason: 'VAL-12: description begins with first-person pronoun',
      canRetry: true,
    }
  }

  return { valid: true, flags, canRetry: true }
}
