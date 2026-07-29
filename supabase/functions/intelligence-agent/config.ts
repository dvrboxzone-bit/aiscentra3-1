/**
 * AIscentra — Intelligence Agent Runtime: Configuration
 */

export const AGENT_RUNTIME_VERSION = 'v1.0-mock'

export const AGENT_CONFIG = {
  // Context loading limits — kept conservative until real data volume is known
  MAX_OBSERVATIONS_PER_LOAD: 20,
  MAX_SIGNALS_PER_LOAD:      15,
  MAX_GRAPH_NODES_PER_LOAD:  10,
  MAX_MEMORY_ENTRIES:        5,
  MAX_ENTITIES_PER_LOAD:     10,

  // Reasoning
  MIN_CONFIDENCE_TO_REPORT_AS_FACT: 7,   // below this, claim must be tagged INFERENCE or lower

  // Execution
  MAX_EXECUTION_STEPS: 10,
  STEP_TIMEOUT_MS:     30_000,

  // Safety — default posture is deny-by-default for write actions
  ALLOWED_ACTIONS_DEFAULT: [
    'READ_OBSERVATIONS',
    'READ_SIGNALS',
    'READ_GRAPH',
    'READ_MEMORY',
    'READ_ENTITY',
  ] as const,

  // Write actions require explicit allow-list entry — never enabled by default
  WRITE_ACTIONS_REQUIRE_EXPLICIT_ALLOW: true,
} as const
