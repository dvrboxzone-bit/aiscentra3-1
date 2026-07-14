/**
 * AIscentra — Database Type Definitions
 *
 * These types mirror the Supabase schema exactly.
 * Source of truth: System Blueprint v1.0 + Signal Scoring Specification v1.0
 *
 * Rule: if the schema changes, these types change first. Then the migration.
 * Never let the migration drift from the types.
 */

// ── Enums ────────────────────────────────────────────────────────────────────

/**
 * Signal lifecycle states — Signal Scoring Specification v1.0, Section 02
 * Terminal states: PROMOTED, EXPIRED, REJECTED (no state reversal permitted)
 */
export type SignalStatus =
  | 'CANDIDATE'
  | 'DRAFT'
  | 'ACTIVE'
  | 'PROMOTED'
  | 'EXPIRED'
  | 'REJECTED'

/**
 * Signal categories — Signal Scoring Specification v1.0, Section 04
 * These are the ONLY valid categories for MVP. No additions without spec update.
 */
export type SignalCategory =
  | 'RESEARCH'
  | 'MODELS'
  | 'COMPANIES'
  | 'INFRASTRUCTURE'
  | 'OPEN_SOURCE'
  | 'FUNDING'
  | 'REGULATION'
  | 'AGENTS'
  | 'HARDWARE'

/**
 * Signal severity display levels — Signal Scoring Specification v1.0, Section 08
 * Derived from signal_score. Display-only — does not affect system logic.
 */
export type SignalSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'

/**
 * Event types — Intelligence Systems Analyst Skill v1.0, Section 04
 */
export type EventType =
  | 'LAUNCH'
  | 'PARTNERSHIP'
  | 'RESEARCH_BREAKTHROUGH'
  | 'FUNDING'
  | 'ACQUISITION'
  | 'INFRASTRUCTURE_CHANGE'
  | 'REGULATORY_DEVELOPMENT'
  | 'STRATEGIC_SHIFT'

/**
 * Report types — MVP Specification v1.0, Section on Report Types
 */
export type ReportType =
  | 'SIGNAL_BRIEF'
  | 'EVENT_ANALYSIS'
  | 'WEEKLY_REVIEW'
  | 'TREND_REPORT'

/**
 * Entity types — System Blueprint v1.0, Entity Model section
 */
export type EntityType =
  | 'COMPANY'
  | 'MODEL'
  | 'RESEARCH_PAPER'
  | 'PERSON'
  | 'PRODUCT'
  | 'AGENT'
  | 'ORGANIZATION'
  | 'TECHNOLOGY'
  | 'INFRASTRUCTURE'
  | 'REGULATION'
  | 'INVESTMENT'
  | 'DATASET'
  | 'TOOL'

/**
 * Epistemic claim types — Intelligence Evolution Framework v1.0, Section 11
 * Every analytical claim must carry one of these types.
 */
export type ClaimType = 'FACTUAL' | 'INTERPRETIVE' | 'HYPOTHETICAL' | 'FORECAST'

/**
 * Forecast outcome tracking — Intelligence Evolution Framework v1.0, Section 04
 */
export type ForecastOutcome =
  | 'UNRESOLVED'
  | 'CONFIRMED'
  | 'PARTIALLY_CONFIRMED'
  | 'CONTRADICTED'

// ── Table Row Types ──────────────────────────────────────────────────────────

export interface Source {
  id: string
  name: string
  type: string
  url: string
  trust_score: number       // 0.0–1.0. Signals require trust_score ≥ 0.5 (Signal Spec PQ-01)
  status: 'ACTIVE' | 'INACTIVE' | 'ERROR'
  created_at: string
  updated_at: string
}

export interface Observation {
  id: string
  source_id: string
  title: string
  content: string           // First 3000 chars stored — Readiness Assessment Blocker B-01 resolved
  url: string
  published_at: string
  collected_at: string
  metadata: Record<string, unknown>
  processed: boolean
  processing_error: string | null
  created_at: string
}

export interface Signal {
  id: string
  title: string             // 10–80 chars (VAL-01)
  description: string       // 50–500 chars (VAL-02)
  category: SignalCategory
  status: SignalStatus

  // Scoring — Signal Scoring Specification v1.0, Sections 05, 06, 07
  // Raw factor scores (0–10 each) — stored for re-weighting and audit
  impact_factor: number
  actor_factor: number
  novelty_factor: number
  verifiability_factor: number
  strategic_factor: number
  authority_factor: number
  corroboration_factor: number
  specificity_factor: number
  category_confidence_factor: number
  consistency_factor: number

  // Computed scores (0–100 integers) — derived server-side from factors
  signal_score: number
  confidence_score: number
  momentum_score: number

  // Lifecycle
  validation_flags: string[]
  manual_override: boolean
  expiration_reason: string | null
  expired_at: string | null

  // Relations
  observation_ids: string[]
  entity_ids: string[]

  // Audit — MVP: stored as JSONB (full audit table in Stage 12)
  metadata: {
    audit_log?: AuditEntry[]
    enrichment_model?: string
    enriched_at?: string
    momentum_calculation?: {
      new_observations_count: number
      distinct_source_count: number
      cross_category_ref_count: number
      base_momentum: number
    }
  }

  momentum_last_calculated: string | null
  created_at: string
  updated_at: string
}

export interface Event {
  id: string
  signal_id: string         // Non-nullable — orphan events forbidden
  title: string
  summary: string
  impact_summary: string
  forecast: string          // Prefixed "Expected:" or "Watch for:" in generation
  forecast_outcome: ForecastOutcome
  impact_score: number      // 0–100 — breadth of ecosystem impact
  event_type: EventType
  timeline_date: string     // When development occurred, not when event was created
  affected_entity_ids: string[]
  manual_override: boolean
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface Report {
  id: string
  title: string
  summary: string
  content: string
  report_type: ReportType
  signal_ids: string[]
  event_ids: string[]
  published_at: string | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface Entity {
  id: string
  name: string
  canonical_name: string    // Normalized for deduplication (lowercase, no punctuation)
  entity_type: EntityType
  description: string | null
  website: string | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface EntityRelationship {
  id: string
  source_entity_id: string
  target_entity_id: string
  relationship_type: string // ISA Skill v1.0, Section 05.3 approved types
  strength: number          // 0.0–1.0
  metadata: Record<string, unknown>
  created_at: string
}

export interface KnowledgeAsset {
  id: string
  title: string
  content: string
  category: string
  importance: number        // 0–100
  version: number           // Intelligence Evolution Framework v1.0 — version-controlled
  previous_version_id: string | null
  version_reason: string | null
  claim_types: ClaimType[]  // What epistemic categories does this asset contain?
  entity_ids: string[]
  metadata: Record<string, unknown>
  updated_at: string
  created_at: string
}

// ── Audit Types ──────────────────────────────────────────────────────────────

export interface AuditEntry {
  field: string
  from: unknown
  to: unknown
  at: string             // ISO timestamp
  by: string             // 'system' | admin email
  reason?: string
}

// ── Computed/Derived Types ───────────────────────────────────────────────────

/**
 * Derives SignalSeverity from signal_score
 * Signal Scoring Specification v1.0, Section 08
 */
export function getSignalSeverity(score: number): SignalSeverity {
  if (score >= 80) return 'CRITICAL'
  if (score >= 60) return 'HIGH'
  if (score >= 40) return 'MEDIUM'
  return 'LOW'
}

/**
 * Checks if a signal is eligible for automatic promotion
 * Signal Scoring Specification v1.0, Section 09.1
 */
export function isPromotionEligible(signal: Pick<Signal, 'signal_score' | 'confidence_score' | 'status' | 'validation_flags' | 'created_at'>): boolean {
  if (signal.status !== 'ACTIVE') return false
  if (signal.signal_score < 70) return false
  if (signal.confidence_score < 65) return false
  if (signal.validation_flags.length > 0) return false

  const ageInDays = (Date.now() - new Date(signal.created_at).getTime()) / (1000 * 60 * 60 * 24)
  if (ageInDays > 7) return false

  return true
}
