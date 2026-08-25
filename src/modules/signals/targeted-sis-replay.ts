import type { ObservationRow } from '@/modules/observations/queries'
import type { StructuredOutputFailureType } from '@/lib/ai/structured-output'

export const TARGETED_SIS_REPLAY_ALLOWLIST = [
  'e4275483-39e4-4441-84a2-0a1df546cf07',
  'ec86e548-8394-4c45-8353-7ba588f23cf3',
  'fc22b35a-776b-4666-aabc-64ea1a198c34',
  'bcf826e4-069c-4627-a4ab-6635ce3e1f7e',
  '5e0938e3-feb2-4531-9ebb-1e53164d219d',
  'cb043c56-7be5-4e9d-9144-2c9c407d9655',
  '91c78285-f310-4dfa-a0ca-0953e8cfdd40',
  '948419ea-27e9-4213-b692-f80c04611cfa',
  'de90407c-d4b9-4eee-862f-12a549f9544d',
] as const

export const TARGETED_SIS_REPAIR_KEY = 'repair_lost_sis_structured_output_20260823_v1'
export const TARGETED_SIS_REPLAY_V1_KEY = 'targeted_sis_replay_20260823_v1'
export const TARGETED_SIS_REPLAY_V2_KEY = 'targeted_sis_replay_20260825_v2'
export const TARGETED_SIS_REPLAY_V2_MARKER_FIELD = 'targeted_sis_replay_v2_key'
export const TARGETED_SIS_REPLAY_V2_AUDIT_FIELD = 'targeted_sis_replay_v2_audit'
export const TARGETED_SIS_REPLAY_V3_CONTROL_ID = TARGETED_SIS_REPLAY_ALLOWLIST[0]
export const TARGETED_SIS_REPLAY_V3_CONTROL_KEY = 'targeted_sis_replay_20260825_v3_control'
export const TARGETED_SIS_REPLAY_V3_CONTROL_MARKER_FIELD = 'targeted_sis_replay_v3_control_key'
export const TARGETED_SIS_REPLAY_V3_CONTROL_AUDIT_FIELD = 'targeted_sis_replay_v3_control_audit'
export const TARGETED_SIS_REPLAY_V4_CONTROL_ID = TARGETED_SIS_REPLAY_ALLOWLIST[0]
export const TARGETED_SIS_REPLAY_V4_CONTROL_KEY = 'targeted_sis_replay_20260825_v4_control'
export const TARGETED_SIS_REPLAY_V4_CONTROL_MARKER_FIELD = 'targeted_sis_replay_v4_control_key'
export const TARGETED_SIS_REPLAY_V4_CONTROL_AUDIT_FIELD = 'targeted_sis_replay_v4_control_audit'

export type StructuredFailureType = StructuredOutputFailureType
export type TargetedReplayDisposition = 'valid' | 'rejected' | 'retried' | 'failed'

export interface TargetedReplayItemResult {
  disposition: TargetedReplayDisposition
  diagnostic?: StructuredFailureType
  diagnostics?: readonly StructuredFailureType[]
  deadlineExceeded?: boolean
}

export interface TargetedReplaySummary {
  requested: number
  eligible: number
  attempted: number
  valid: number
  rejected: number
  retried: number
  failed: number
  deadline_exceeded: number
  diagnostic_counts: Record<StructuredFailureType, number>
  complete: boolean
}

export interface TargetedReplayDeps {
  loadEligible: (ids: readonly string[]) => Promise<ObservationRow[]>
  claim: (observation: ObservationRow) => Promise<ObservationRow | null>
  processOne: (observation: ObservationRow, deadlineAt: number) => Promise<TargetedReplayItemResult>
  canStart?: (observation: ObservationRow, deadlineAt: number) => Promise<boolean>
  isEligible?: (observation: ObservationRow, nowMs: number) => boolean
  now?: () => number
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MINIMUM_ATTEMPT_WINDOW_MS = 8_000
const ALLOWED_IDS = new Set<string>(TARGETED_SIS_REPLAY_ALLOWLIST)

export function parseTargetedReplayRequest(
  body: unknown,
): { ok: true; observationIds: string[] } | { ok: false; error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Body must be an object' }
  }

  const keys = Object.keys(body as Record<string, unknown>)
  if (keys.length !== 1 || keys[0] !== 'observationIds') {
    return { ok: false, error: 'Only observationIds is accepted' }
  }

  const ids = (body as { observationIds?: unknown }).observationIds
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    ids.length > TARGETED_SIS_REPLAY_ALLOWLIST.length
  ) {
    return { ok: false, error: 'observationIds must contain 1 to 9 IDs' }
  }
  if (ids.some((id) => typeof id !== 'string' || !UUID_PATTERN.test(id))) {
    return { ok: false, error: 'Every observationId must be a UUID' }
  }

  const normalized = ids as string[]
  if (new Set(normalized).size !== normalized.length) {
    return { ok: false, error: 'Duplicate observationIds are not accepted' }
  }
  if (normalized.some((id) => !ALLOWED_IDS.has(id))) {
    return { ok: false, error: 'One or more observationIds are not allowlisted' }
  }

  return { ok: true, observationIds: normalized }
}

export function parseTargetedReplayV3ControlRequest(
  body: unknown,
): { ok: true; observationIds: [string] } | { ok: false; error: string } {
  const parsed = parseTargetedReplayRequest(body)
  if (!parsed.ok) return parsed
  if (
    parsed.observationIds.length !== 1 ||
    parsed.observationIds[0] !== TARGETED_SIS_REPLAY_V3_CONTROL_ID
  ) {
    return { ok: false, error: 'V3 control accepts only its single server-side control ID' }
  }
  return { ok: true, observationIds: [TARGETED_SIS_REPLAY_V3_CONTROL_ID] }
}

export function parseTargetedReplayV4ControlRequest(
  body: unknown,
): { ok: true; observationIds: [string] } | { ok: false; error: string } {
  const parsed = parseTargetedReplayRequest(body)
  if (!parsed.ok) return parsed
  if (
    parsed.observationIds.length !== 1 ||
    parsed.observationIds[0] !== TARGETED_SIS_REPLAY_V4_CONTROL_ID
  ) {
    return { ok: false, error: 'V4 control accepts only its single server-side control ID' }
  }
  return { ok: true, observationIds: [TARGETED_SIS_REPLAY_V4_CONTROL_ID] }
}

export function isTargetedReplayEligible(observation: ObservationRow, nowMs = Date.now()): boolean {
  if (!ALLOWED_IDS.has(observation.id)) return false
  if (observation.processed) return false
  if (observation.processing_error !== null) return false
  if (observation.signal_id !== null) return false
  if (observation.rejection_code !== null) return false

  const metadata = observation.metadata ?? {}
  if (metadata['repair_key'] !== TARGETED_SIS_REPAIR_KEY) return false
  // A v1 marker is durable history, not a v2 eligibility gate. The distinct
  // v2 field grants exactly one new campaign attempt without overwriting v1.
  if (metadata[TARGETED_SIS_REPLAY_V2_MARKER_FIELD] !== undefined) return false

  const retryAfter = metadata['retry_after']
  if (retryAfter !== undefined) {
    if (typeof retryAfter !== 'string') return false
    const retryAfterMs = Date.parse(retryAfter)
    if (!Number.isFinite(retryAfterMs) || retryAfterMs > nowMs) return false
  }
  return true
}

export function isTargetedReplayV3ControlEligible(
  observation: ObservationRow,
  nowMs = Date.now(),
): boolean {
  if (observation.id !== TARGETED_SIS_REPLAY_V3_CONTROL_ID) return false
  if (observation.processed) return false
  if (observation.processing_error !== null) return false
  if (observation.signal_id !== null) return false
  if (observation.rejection_code !== null) return false
  const metadata = observation.metadata ?? {}
  if (metadata['repair_key'] !== TARGETED_SIS_REPAIR_KEY) return false
  // v1/v2 are immutable audit history. Only the date-stamped v3 control
  // marker gates this new, separately authorized checkpoint.
  if (metadata[TARGETED_SIS_REPLAY_V3_CONTROL_MARKER_FIELD] !== undefined) return false
  const retryAfter = metadata['retry_after']
  if (retryAfter !== undefined) {
    if (typeof retryAfter !== 'string') return false
    const retryAfterMs = Date.parse(retryAfter)
    if (!Number.isFinite(retryAfterMs) || retryAfterMs > nowMs) return false
  }
  return true
}

export function isTargetedReplayV4ControlEligible(
  observation: ObservationRow,
  nowMs = Date.now(),
): boolean {
  if (observation.id !== TARGETED_SIS_REPLAY_V4_CONTROL_ID) return false
  if (observation.processed) return false
  if (observation.processing_error !== null) return false
  if (observation.signal_id !== null) return false
  if (observation.rejection_code !== null) return false
  const metadata = observation.metadata ?? {}
  if (metadata['repair_key'] !== TARGETED_SIS_REPAIR_KEY) return false
  // V1/V2/V3 remain immutable history. Only the additive V4 marker gates V4.
  if (metadata[TARGETED_SIS_REPLAY_V4_CONTROL_MARKER_FIELD] !== undefined) return false
  const retryAfter = metadata['retry_after']
  if (retryAfter !== undefined) {
    if (typeof retryAfter !== 'string') return false
    const retryAfterMs = Date.parse(retryAfter)
    if (!Number.isFinite(retryAfterMs) || retryAfterMs > nowMs) return false
  }
  return true
}

function freshSummary(requested: number): TargetedReplaySummary {
  return {
    requested,
    eligible: 0,
    attempted: 0,
    valid: 0,
    rejected: 0,
    retried: 0,
    failed: 0,
    deadline_exceeded: 0,
    diagnostic_counts: {
      json_parse: 0,
      schema_validation: 0,
      output_truncated: 0,
      invalid_response_envelope: 0,
    },
    complete: true,
  }
}

/**
 * Runs only rows returned by the targeted loader. There is deliberately no
 * dependency capable of fetching the general observation queue.
 */
export async function runTargetedSisReplay(
  observationIds: readonly string[],
  deadlineAt: number,
  deps: TargetedReplayDeps,
): Promise<TargetedReplaySummary> {
  const summary = freshSummary(observationIds.length)
  const requestedOrder = new Map(observationIds.map((id, index) => [id, index]))
  const now = deps.now ?? Date.now
  const isEligible = deps.isEligible ?? isTargetedReplayEligible
  const loaded = await deps.loadEligible(observationIds)
  const seenEligible = new Set<string>()
  const eligible = loaded
    .filter((row) => {
      if (seenEligible.has(row.id)) return false
      if (!requestedOrder.has(row.id) || !isEligible(row, now())) return false
      seenEligible.add(row.id)
      return true
    })
    .sort(
      (left, right) =>
        (requestedOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
        (requestedOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER),
    )

  summary.eligible = eligible.length

  for (const observation of eligible) {
    if (deadlineAt - now() < MINIMUM_ATTEMPT_WINDOW_MS) {
      summary.complete = false
      break
    }

    if (deps.canStart && !(await deps.canStart(observation, deadlineAt))) {
      summary.complete = false
      break
    }

    const claimed = await deps.claim(observation)
    if (!claimed) {
      summary.complete = false
      continue
    }

    summary.attempted++
    try {
      const result = await deps.processOne(claimed, deadlineAt)
      summary[result.disposition]++
      const diagnostics = new Set(result.diagnostics ?? [])
      if (result.diagnostic) diagnostics.add(result.diagnostic)
      for (const diagnostic of diagnostics) summary.diagnostic_counts[diagnostic]++
      if (result.deadlineExceeded) summary.deadline_exceeded++
    } catch {
      summary.failed++
    }
  }

  return summary
}
