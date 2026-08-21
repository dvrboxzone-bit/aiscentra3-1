/**
 * AIscentra — Database Type Definitions
 * Updated for Signal Engine V2
 */

// ── Enums ────────────────────────────────────────────────────────────────────

export type SignalStatus =
  | 'CANDIDATE'
  | 'DRAFT'
  | 'WEAK' // V2: Interesting but insufficiently validated
  | 'ACTIVE'
  | 'PROMOTED'
  | 'EXPIRED'
  | 'DORMANT' // V2: Archived but monitored for reactivation
  | 'REJECTED'

export type IntelligenceType = 'OBSERVATION' | 'WEAK_SIGNAL' | 'SIGNAL' | 'CRITICAL_SIGNAL' // reserved

export type RelevanceHorizon =
  | 'DAYS' // < 1 week
  | 'WEEKS' // 1-4 weeks
  | 'MONTHS' // 1-6 months
  | 'YEARS' // 6-24 months
  | 'STRUCTURAL' // 2-5 years

export type QualificationResult = 'DISCARD' | 'ARCHIVE' | 'WEAK_SIGNAL' | 'SIGNAL'

// Rejection codes R-01 through R-12
export type RejectionCode =
  | 'R-01' // NO_DECISION_IMPACT
  | 'R-02' // BENCHMARK_ONLY
  | 'R-03' // INCREMENTAL_BELOW_THRESHOLD
  | 'R-04' // SINGLE_DOMAIN_ACADEMIC
  | 'R-05' // PROMOTIONAL_CONTENT
  | 'R-06' // DERIVATIVE_WORK
  | 'R-07' // NO_EXTERNAL_VALIDATION
  | 'R-08' // TEMPORAL_IRRELEVANCE
  | 'R-09' // ZERO_HUMAN_RELEVANCE
  | 'R-10' // LOW_CONFIDENCE
  | 'R-11' // DUPLICATE_SIGNAL
  | 'R-12' // CATEGORY_DEFAULT_REJECT
  | 'R-13' // DETERMINISTIC_PREFILTER (zero-AI-cost score below PRE_FILTER_MIN)

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

export type SignalSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'

export type SignalQualityState = 'PENDING' | 'APPROVED' | 'QUARANTINED'

export type SignalQualityReasonCode =
  | 'AWAITING_QUALITY_REVIEW'
  | 'LEGACY_STATUS_WEAK'
  | 'LEGACY_STATUS_DORMANT'
  | 'LEGACY_STATUS_EXPIRED'
  | 'LEGACY_STATUS_REJECTED'

export type EventType =
  | 'LAUNCH'
  | 'PARTNERSHIP'
  | 'RESEARCH_BREAKTHROUGH'
  | 'FUNDING'
  | 'ACQUISITION'
  | 'INFRASTRUCTURE_CHANGE'
  | 'REGULATORY_DEVELOPMENT'
  | 'STRATEGIC_SHIFT'

export type ReportType = 'SIGNAL_BRIEF' | 'EVENT_ANALYSIS' | 'WEEKLY_REVIEW' | 'TREND_REPORT'

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

export type ClaimType = 'FACTUAL' | 'INTERPRETIVE' | 'HYPOTHETICAL' | 'FORECAST'

export type ForecastOutcome = 'UNRESOLVED' | 'CONFIRMED' | 'PARTIALLY_CONFIRMED' | 'CONTRADICTED'

// ── V2: Strategic Importance Score ───────────────────────────────────────────

export interface StrategicImportanceScore {
  novelty: number // 0-10: genuinely new capability or approach
  importance: number // 0-10: ecosystem-wide consequence if adopted
  urgency: number // 0-10: time sensitivity for decision-makers
  confidence: number // 0-10: evidence quality and corroboration
  final: number // weighted: (N×0.25)+(I×0.35)+(U×0.20)+(C×0.20)
}

// ── V2: Human Relevance ──────────────────────────────────────────────────────

export interface HumanRelevanceFlags {
  cto: boolean
  research_director: boolean
  vc: boolean
  founder: boolean
  government_analyst: boolean
  enterprise_architect: boolean
  roles_yes_count: number
}

// ── V2: Qualification breakdown ──────────────────────────────────────────────

export interface QualificationCriterion {
  score: number
  weight: number
  weighted: number
  reason: string
}

export interface QualificationBreakdown {
  changes_technology: QualificationCriterion
  changes_engineering: QualificationCriterion
  changes_adoption: QualificationCriterion
  changes_investment: QualificationCriterion
  changes_science: QualificationCriterion
  competitive_advantage: QualificationCriterion
  invalidates_prior: QualificationCriterion
  changes_regulation: QualificationCriterion
  changes_infrastructure: QualificationCriterion
  total: number
}

// ── V2: Knowledge Graph ──────────────────────────────────────────────────────

export type GraphNodeType =
  | 'observation'
  | 'signal'
  | 'entity'
  | 'technology'
  | 'company'
  | 'paper'
  | 'model'
  | 'person'
  | 'event'
  | 'concept'
  | 'dataset'
  | 'benchmark'
  | 'product'

export type GraphRelationType =
  | 'ENABLES'
  | 'CONTRADICTS'
  | 'DEPENDS_ON'
  | 'PRECEDES'
  | 'INVALIDATES'
  | 'DERIVED_FROM'
  | 'AUTHORED_BY'
  | 'PUBLISHED_IN'
  | 'REFERENCES'
  | 'PART_OF'

export interface KnowledgeGraphNode {
  id: string
  node_type: GraphNodeType
  node_id: string | null
  canonical_id: string | null
  is_canonical: boolean
  label: string
  aliases: string[]
  description: string | null
  properties: Record<string, unknown>
  importance_score: number | null
  source_count: number
  embedding_ready: boolean
  engine_version: string
  first_seen: string
  last_updated: string
  created_at: string
}

export interface IntelligenceGraphEdge {
  id: string
  from_node_id: string
  to_node_id: string
  from_type: GraphNodeType
  to_type: GraphNodeType
  relation_type: GraphRelationType
  relation_weight: number
  confidence: number
  source: string
  edge_reason: string | null
  evidence: string | null
  valid_until: string | null
  engine_version: string
  created_by: string
  created_at: string
  updated_at: string
}

// ── V2: Entity Registry ──────────────────────────────────────────────────────

export interface EntityRegistry {
  id: string
  canonical_name: string
  entity_type: string
  canonical_id: string | null
  aliases: string[]
  alias_sources: Record<string, string>
  description: string | null
  properties: Record<string, unknown>
  external_ids: {
    doi?: string
    arxiv?: string
    github?: string
    crunchbase?: string
    openalex?: string
    semantic_scholar?: string
    huggingface?: string
    wikipedia?: string
    ror?: string
    [key: string]: string | undefined
  }
  confidence: number
  resolved_by: string
  verified: boolean
  signal_count: number
  engine_version: string
  first_seen: string
  last_updated: string
}

// ── V2: Decision Log ─────────────────────────────────────────────────────────

export interface SignalDecisionLog {
  id: string
  signal_id: string | null
  observation_id: string
  decision: QualificationResult
  previous_decision: string | null
  qualification_score: number | null
  qualification_breakdown: QualificationBreakdown | Record<string, unknown>
  sis_novelty: number | null
  sis_importance: number | null
  sis_urgency: number | null
  sis_confidence: number | null
  sis_final: number | null
  human_relevance_breakdown: HumanRelevanceFlags | Record<string, unknown>
  anti_hype_score: number | null
  anti_hype_flags: Record<string, unknown>
  rejection_code: RejectionCode | null
  rejection_reason: string | null
  promotion_from: string | null
  engine_justification: string | null
  thresholds_snapshot: Record<string, unknown>
  engine_version: string
  decided_at: string
}

// ── V2: Feedback ─────────────────────────────────────────────────────────────

export interface SignalFeedback {
  id: string
  signal_id: string | null
  observation_id: string | null
  feedback_type: 'user' | 'analyst' | 'system' | 'market'
  feedback_event:
    | 'viewed'
    | 'shared'
    | 'flagged_wrong'
    | 'flagged_important'
    | 'cited'
    | 'superseded'
    | 'promoted'
    | 'demoted'
  score_delta: number | null
  dimension: 'novelty' | 'importance' | 'urgency' | 'confidence' | null
  reason: string | null
  evidence: Record<string, unknown>
  applied: boolean
  applied_at: string | null
  engine_version: string
  created_at: string
}

// ── Table Row Types ──────────────────────────────────────────────────────────

export interface Source {
  id: string
  name: string
  type: string
  url: string
  trust_score: number
  status: 'ACTIVE' | 'INACTIVE' | 'ERROR'
  created_at: string
  updated_at: string
}

export interface Observation {
  id: string
  source_id: string
  title: string
  content: string
  url: string
  published_at: string
  collected_at: string
  metadata: Record<string, unknown>
  processed: boolean
  processing_error: string | null
  // V2 fields
  qualification_result: QualificationResult | null
  rejection_code: RejectionCode | null
  rejection_reason: string | null
  rejection_detail: Record<string, unknown>
  qualification_score: number | null
  dry_run_result: Record<string, unknown>
  engine_version: string
  created_at: string
}

export interface Signal {
  id: string
  title: string
  description: string
  category: SignalCategory
  status: SignalStatus

  // V1 scoring factors
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

  // Computed scores
  signal_score: number
  confidence_score: number
  momentum_score: number

  // V2: Intelligence classification
  intelligence_type: IntelligenceType
  qualification_score: number | null
  qualification_detail: Record<string, unknown>

  // V2: Strategic Importance Score
  sis_novelty: number | null
  sis_importance: number | null
  sis_urgency: number | null
  sis_confidence: number | null
  sis_final: number | null

  // V2: Future relevance
  relevance_horizon: RelevanceHorizon | null
  relevance_detail: Record<string, unknown>

  // V2: Reality check
  anti_hype_score: number | null
  anti_hype_flags: Record<string, unknown>

  // V2: Human relevance
  human_relevance_flags: HumanRelevanceFlags | Record<string, unknown>

  // V2: Lifecycle
  lifecycle_state: string
  dormant_reason: string | null
  reactivate_after: string | null

  // Quality-First foundation (Phase 1)
  quality_state: SignalQualityState
  quality_reason_codes: SignalQualityReasonCode[]
  quality_rule_version: string
  quality_evaluated_at: string | null
  quarantined_at: string | null

  // V1: Lifecycle
  validation_flags: string[]
  manual_override: boolean
  expiration_reason: string | null
  expired_at: string | null

  // Relations
  observation_ids: string[]
  entity_ids: string[]
  metadata: Record<string, unknown>

  // Engine versioning
  engine_version: string
  momentum_last_calculated: string | null
  created_at: string
  updated_at: string
}

export interface Event {
  id: string
  signal_id: string
  title: string
  summary: string
  impact_summary: string
  forecast: string
  forecast_outcome: ForecastOutcome
  impact_score: number
  event_type: EventType
  timeline_date: string
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
  canonical_name: string
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
  relationship_type: string
  strength: number
  metadata: Record<string, unknown>
  created_at: string
}

export interface KnowledgeAsset {
  id: string
  title: string
  content: string
  category: string
  importance: number
  version: number
  previous_version_id: string | null
  version_reason: string | null
  claim_types: ClaimType[]
  entity_ids: string[]
  metadata: Record<string, unknown>
  updated_at: string
  created_at: string
}

export interface AuditEntry {
  field: string
  from: unknown
  to: unknown
  at: string
  by: string
  reason?: string
}

// ── Computed helpers ──────────────────────────────────────────────────────────

export function getSignalSeverity(score: number): SignalSeverity {
  if (score >= 80) return 'CRITICAL'
  if (score >= 60) return 'HIGH'
  if (score >= 40) return 'MEDIUM'
  return 'LOW'
}

export function computeSISFinal(sis: Omit<StrategicImportanceScore, 'final'>): number {
  return sis.novelty * 0.25 + sis.importance * 0.35 + sis.urgency * 0.2 + sis.confidence * 0.2
}

export function classifyBySIS(sisFinal: number): QualificationResult {
  if (sisFinal >= 6.0) return 'SIGNAL'
  if (sisFinal >= 4.0) return 'WEAK_SIGNAL'
  if (sisFinal >= 2.0) return 'ARCHIVE'
  return 'DISCARD'
}

export function isPromotionEligible(
  signal: Pick<
    Signal,
    'signal_score' | 'confidence_score' | 'status' | 'validation_flags' | 'created_at'
  >,
): boolean {
  if (signal.status !== 'ACTIVE') return false
  if (signal.signal_score < 70) return false
  if (signal.confidence_score < 65) return false
  if (signal.validation_flags.length > 0) return false
  const ageInDays = (Date.now() - new Date(signal.created_at).getTime()) / 86400000
  if (ageInDays > 7) return false
  return true
}
