import type { Signal } from '@/types/database'

export function makeSignal(overrides: Partial<Signal>): Signal {
  return {
    id: 'sig-default',
    title: 'Default Signal Title',
    description: 'Default signal description.',
    category: 'MODELS',
    status: 'ACTIVE',
    impact_factor: 5,
    actor_factor: 5,
    novelty_factor: 5,
    verifiability_factor: 5,
    strategic_factor: 5,
    authority_factor: 5,
    corroboration_factor: 5,
    specificity_factor: 5,
    category_confidence_factor: 5,
    consistency_factor: 5,
    signal_score: 65,
    confidence_score: 70,
    momentum_score: 0,
    intelligence_type: 'SIGNAL',
    qualification_score: 65,
    qualification_detail: {},
    sis_novelty: 5,
    sis_importance: 5,
    sis_urgency: 5,
    sis_confidence: 5,
    sis_final: 65,
    relevance_horizon: 'MONTHS',
    relevance_detail: {},
    anti_hype_score: 5,
    anti_hype_flags: {},
    human_relevance_flags: {},
    lifecycle_state: 'ACTIVE',
    dormant_reason: null,
    reactivate_after: null,
    validation_flags: [],
    manual_override: false,
    expiration_reason: null,
    expired_at: null,
    observation_ids: [],
    entity_ids: [],
    metadata: {},
    engine_version: 'v2',
    momentum_last_calculated: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  } as Signal
}

export function sixRealSignals(): Signal[] {
  return Array.from({ length: 6 }, (_, i) =>
    makeSignal({ id: `featured-${i}`, title: `Real Featured Signal ${i}` }),
  )
}

export function twoRealObservations(): Signal[] {
  return Array.from({ length: 2 }, (_, i) =>
    makeSignal({ id: `obs-${i}`, title: `Real Observation Signal ${i}` }),
  )
}

/**
 * Requests reduced motion so Hero Density Scan renders one static frame.
 * Strategic Memory intentionally keeps its required animation contract;
 * dom-setup's IntersectionObserver reports it offscreen on the next microtask.
 */
export function forceReducedMotion(): () => void {
  const original = window.matchMedia
  window.matchMedia = ((query: string) => ({
    matches: query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  })) as any
  return () => {
    window.matchMedia = original
  }
}
