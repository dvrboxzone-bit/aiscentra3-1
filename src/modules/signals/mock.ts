/**
 * AIscentra — Signal Mock Data
 *
 * Used in Stage 5 (Static Prototype) before the Signal Engine is operational.
 * Mock data matches the exact shape of production Signal records.
 * Switching to real data = replace these functions with Supabase queries.
 * Zero component changes required.
 */
import type { Signal, SignalCategory, SignalStatus } from '@/types/database'
import { getSignalSeverity } from '@/types/database'

// ── Mock Signals ──────────────────────────────────────────────────────────────

const MOCK_SIGNALS: Signal[] = [
  {
    id: 'sig-001',
    title: 'Anthropic releases Claude 4 with extended context and improved reasoning',
    description:
      'Anthropic has released Claude 4, featuring a 500K token context window and significant improvements in multi-step reasoning tasks. The release includes API access and updated safety evaluations. Early benchmarks show performance improvements across mathematical reasoning and code generation categories.',
    category: 'MODELS',
    status: 'ACTIVE',
    signal_score: 88,
    confidence_score: 91,
    momentum_score: 74,
    impact_factor: 9,
    actor_factor: 9,
    novelty_factor: 8,
    verifiability_factor: 10,
    strategic_factor: 9,
    authority_factor: 10,
    corroboration_factor: 8,
    specificity_factor: 9,
    category_confidence_factor: 10,
    consistency_factor: 7,
    validation_flags: [],
    manual_override: false,
    expiration_reason: null,
    expired_at: null,
    observation_ids: ['obs-001'],
    entity_ids: ['ent-anthropic', 'ent-claude'],
    momentum_last_calculated: new Date(Date.now() - 3600000).toISOString(),
    metadata: {
      enrichment_model: 'anthropic/claude-3-haiku',
      enriched_at: new Date(Date.now() - 7200000).toISOString(),
    },
    created_at: new Date(Date.now() - 14400000).toISOString(),
    updated_at: new Date(Date.now() - 3600000).toISOString(),
  },
  {
    id: 'sig-002',
    title: 'EU AI Act enforcement begins for general-purpose AI model providers',
    description:
      'The European Union has begun enforcement of the AI Act provisions applicable to general-purpose AI model providers. Companies releasing models above the 10^25 FLOP training threshold must now comply with transparency and capability evaluation requirements. The European AI Office has published implementation guidelines.',
    category: 'REGULATION',
    status: 'ACTIVE',
    signal_score: 82,
    confidence_score: 87,
    momentum_score: 61,
    impact_factor: 10,
    actor_factor: 9,
    novelty_factor: 7,
    verifiability_factor: 9,
    strategic_factor: 9,
    authority_factor: 9,
    corroboration_factor: 8,
    specificity_factor: 8,
    category_confidence_factor: 9,
    consistency_factor: 7,
    validation_flags: [],
    manual_override: false,
    expiration_reason: null,
    expired_at: null,
    observation_ids: ['obs-002'],
    entity_ids: ['ent-eu', 'ent-eu-ai-office'],
    momentum_last_calculated: new Date(Date.now() - 3600000).toISOString(),
    metadata: {
      enrichment_model: 'anthropic/claude-3-haiku',
      enriched_at: new Date(Date.now() - 86400000).toISOString(),
    },
    created_at: new Date(Date.now() - 172800000).toISOString(),
    updated_at: new Date(Date.now() - 3600000).toISOString(),
  },
  {
    id: 'sig-003',
    title: 'Mistral AI open-sources Mistral Large 3 weights under Apache 2.0',
    description:
      'Mistral AI has released the full weights of Mistral Large 3 under an Apache 2.0 license, making it freely available for commercial and research use. The model shows competitive performance with closed-source alternatives on standard benchmarks. This represents a significant open source contribution to the frontier model ecosystem.',
    category: 'OPEN_SOURCE',
    status: 'ACTIVE',
    signal_score: 79,
    confidence_score: 88,
    momentum_score: 83,
    impact_factor: 8,
    actor_factor: 7,
    novelty_factor: 7,
    verifiability_factor: 9,
    strategic_factor: 8,
    authority_factor: 9,
    corroboration_factor: 8,
    specificity_factor: 9,
    category_confidence_factor: 9,
    consistency_factor: 7,
    validation_flags: [],
    manual_override: false,
    expiration_reason: null,
    expired_at: null,
    observation_ids: ['obs-003'],
    entity_ids: ['ent-mistral'],
    momentum_last_calculated: new Date(Date.now() - 3600000).toISOString(),
    metadata: {
      enrichment_model: 'anthropic/claude-3-haiku',
      enriched_at: new Date(Date.now() - 28800000).toISOString(),
    },
    created_at: new Date(Date.now() - 43200000).toISOString(),
    updated_at: new Date(Date.now() - 3600000).toISOString(),
  },
  {
    id: 'sig-004',
    title: 'Google announces TPU v6 with 3× training throughput improvement',
    description:
      'Google has announced the sixth generation of its Tensor Processing Unit, delivering approximately three times the training throughput of TPU v5. The hardware will be available through Google Cloud and will support training runs for models above 100B parameters. Pricing and availability have been disclosed for select enterprise partners.',
    category: 'HARDWARE',
    status: 'ACTIVE',
    signal_score: 71,
    confidence_score: 78,
    momentum_score: 45,
    impact_factor: 8,
    actor_factor: 9,
    novelty_factor: 6,
    verifiability_factor: 7,
    strategic_factor: 7,
    authority_factor: 9,
    corroboration_factor: 6,
    specificity_factor: 8,
    category_confidence_factor: 8,
    consistency_factor: 7,
    validation_flags: [],
    manual_override: false,
    expiration_reason: null,
    expired_at: null,
    observation_ids: ['obs-004'],
    entity_ids: ['ent-google'],
    momentum_last_calculated: new Date(Date.now() - 3600000).toISOString(),
    metadata: {
      enrichment_model: 'anthropic/claude-3-haiku',
      enriched_at: new Date(Date.now() - 57600000).toISOString(),
    },
    created_at: new Date(Date.now() - 86400000).toISOString(),
    updated_at: new Date(Date.now() - 3600000).toISOString(),
  },
  {
    id: 'sig-005',
    title: 'Stanford HAI publishes AI Index 2025 with ecosystem activity metrics',
    description:
      'Stanford University\'s Human-Centered AI Institute has released the 2025 AI Index report, documenting investment flows, research publication rates, and capability progression across the AI ecosystem. The report includes new metrics on agent deployment and infrastructure investment that provide structured historical context for ecosystem analysis.',
    category: 'RESEARCH',
    status: 'ACTIVE',
    signal_score: 64,
    confidence_score: 82,
    momentum_score: 38,
    impact_factor: 7,
    actor_factor: 7,
    novelty_factor: 5,
    verifiability_factor: 9,
    strategic_factor: 6,
    authority_factor: 9,
    corroboration_factor: 7,
    specificity_factor: 8,
    category_confidence_factor: 9,
    consistency_factor: 7,
    validation_flags: [],
    manual_override: false,
    expiration_reason: null,
    expired_at: null,
    observation_ids: ['obs-005'],
    entity_ids: ['ent-stanford'],
    momentum_last_calculated: new Date(Date.now() - 3600000).toISOString(),
    metadata: {
      enrichment_model: 'anthropic/claude-3-haiku',
      enriched_at: new Date(Date.now() - 115200000).toISOString(),
    },
    created_at: new Date(Date.now() - 259200000).toISOString(),
    updated_at: new Date(Date.now() - 3600000).toISOString(),
  },
  {
    id: 'sig-006',
    title: 'Scale AI raises $1.4B Series F at $14B valuation for data infrastructure expansion',
    description:
      'Scale AI has completed a $1.4 billion Series F funding round at a $14 billion valuation, with participation from existing investors and new strategic partners. The capital will be used to expand data labeling infrastructure and develop new evaluation frameworks for frontier AI models. This represents one of the largest AI infrastructure investment rounds of 2025.',
    category: 'FUNDING',
    status: 'ACTIVE',
    signal_score: 76,
    confidence_score: 85,
    momentum_score: 52,
    impact_factor: 8,
    actor_factor: 7,
    novelty_factor: 5,
    verifiability_factor: 9,
    strategic_factor: 8,
    authority_factor: 9,
    corroboration_factor: 7,
    specificity_factor: 9,
    category_confidence_factor: 9,
    consistency_factor: 7,
    validation_flags: [],
    manual_override: false,
    expiration_reason: null,
    expired_at: null,
    observation_ids: ['obs-006'],
    entity_ids: ['ent-scale-ai'],
    momentum_last_calculated: new Date(Date.now() - 3600000).toISOString(),
    metadata: {
      enrichment_model: 'anthropic/claude-3-haiku',
      enriched_at: new Date(Date.now() - 43200000).toISOString(),
    },
    created_at: new Date(Date.now() - 72000000).toISOString(),
    updated_at: new Date(Date.now() - 3600000).toISOString(),
  },
]

// ── Query Functions (same interface as future Supabase queries) ───────────────

export interface SignalFilters {
  category?: SignalCategory
  status?: SignalStatus
  minScore?: number
  limit?: number
}

export function getMockSignals(filters: SignalFilters = {}): Signal[] {
  let signals = [...MOCK_SIGNALS]

  if (filters.category) {
    signals = signals.filter((s) => s.category === filters.category)
  }
  if (filters.status) {
    signals = signals.filter((s) => s.status === filters.status)
  }
  if (filters.minScore !== undefined) {
    signals = signals.filter((s) => s.signal_score >= filters.minScore!)
  }

  signals.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

  if (filters.limit) {
    signals = signals.slice(0, filters.limit)
  }

  return signals
}

export function getMockSignalBySlug(slug: string): Signal | null {
  // Slug format: first 40 chars of title, lowercased, hyphenated + id suffix
  return MOCK_SIGNALS.find((s) => s.id === slug || slugify(s.title) === slug) ?? null
}

export function getMockCriticalSignals(): Signal[] {
  return MOCK_SIGNALS.filter((s) => getSignalSeverity(s.signal_score) === 'CRITICAL').slice(0, 3)
}

export function getMockSignalStats(): {
  total: number
  critical: number
  high: number
  byCategory: Record<string, number>
} {
  const active = MOCK_SIGNALS.filter((s) => s.status === 'ACTIVE')
  const byCategory: Record<string, number> = {}

  for (const s of active) {
    byCategory[s.category] = (byCategory[s.category] ?? 0) + 1
  }

  return {
    total: active.length,
    critical: active.filter((s) => getSignalSeverity(s.signal_score) === 'CRITICAL').length,
    high: active.filter((s) => getSignalSeverity(s.signal_score) === 'HIGH').length,
    byCategory,
  }
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
}
