import type { ModelRef, ProviderName } from '@/lib/ai/config'
import {
  AIInvalidResponseEnvelopeError,
  AIProviderError,
  estimateRequestTokens,
} from '@/lib/ai/client'
import { AIDeadlineExceededError } from '@/lib/ai/deadline'
import { AIStructuredOutputError } from '@/lib/ai/structured-output'
import { checkTPMBudget, fitsWithinModelTPM } from '@/lib/ai/tpm-manager'
import type { AIMessage } from '@/lib/ai/client'

export const DURABLE_SIS_V1_CONTROL_KEY = 'durable_sis_v1_control_20260825'
export const DURABLE_SIS_V1_CLASSIFIER_MAX_TOKENS = 1024
export const DURABLE_SIS_V1_STAGE_DEADLINE_MS = 45_000

export type DurableSisStage = 'CLASSIFIER' | 'PARSER'

export interface SafeDurableDiagnostic {
  type:
    | 'json_parse'
    | 'schema_validation'
    | 'output_truncated'
    | 'invalid_response_envelope'
    | 'provider_error'
    | 'deadline_exceeded'
    | 'budget_unavailable'
    | 'delivery_uncertain'
  provider: ProviderName
  model: string
  http_status: number
  finish_reason: string | null
  content_length: number
  retry_after_ms?: number
}

export type DurableBudgetReservation =
  | { unitKind: 'groq_tokens'; units: number }
  | { unitKind: 'provider_request'; units: 1 }

export function budgetReservationFor(
  messages: readonly AIMessage[],
  ref: ModelRef,
  outputBudget: number,
): DurableBudgetReservation {
  if (ref.provider === 'groq') {
    return {
      unitKind: 'groq_tokens' as const,
      units: estimateRequestTokens([...messages], outputBudget),
    }
  }
  return { unitKind: 'provider_request' as const, units: 1 }
}

export interface DurableAttemptWindowProbe {
  (ref: ModelRef, estimatedTokens: number): boolean
}

const defaultAttemptWindowProbe: DurableAttemptWindowProbe = (ref, estimatedTokens) => {
  const ceiling = fitsWithinModelTPM(ref.model, estimatedTokens)
  if (!ceiling.fits) return false
  return checkTPMBudget(ref.model, estimatedTokens).allowed
}

/**
 * Selects only a provider that can start with a full stage window now. A model
 * that would first consume that window in a local TPM wait is skipped without
 * creating or reserving a doomed attempt.
 */
export function firstRunnableModel(
  chain: readonly ModelRef[],
  messages: readonly AIMessage[],
  outputBudget: number,
  probe: DurableAttemptWindowProbe = defaultAttemptWindowProbe,
): ModelRef | null {
  return (
    chain.find((candidate) =>
      probe(candidate, estimateRequestTokens([...messages], outputBudget)),
    ) ?? null
  )
}

export function nextRunnableModel(
  chain: readonly ModelRef[],
  current: ModelRef,
  messages: readonly AIMessage[],
  outputBudget: number,
  probe: DurableAttemptWindowProbe = defaultAttemptWindowProbe,
): ModelRef | null {
  const currentIndex = chain.findIndex(
    (candidate) => candidate.provider === current.provider && candidate.model === current.model,
  )
  return currentIndex < 0
    ? null
    : firstRunnableModel(chain.slice(currentIndex + 1), messages, outputBudget, probe)
}

export function nextModel(chain: readonly ModelRef[], current: ModelRef): ModelRef | null {
  const index = chain.findIndex(
    (candidate) => candidate.provider === current.provider && candidate.model === current.model,
  )
  return index >= 0 ? (chain[index + 1] ?? null) : null
}

/** A queue delivery is deliberately incapable of invoking more than one provider. */
export async function invokeOneProvider<T>(invoke: () => Promise<T>): Promise<T> {
  return invoke()
}

export function safeDiagnostic(error: unknown, ref: ModelRef): SafeDurableDiagnostic {
  if (error instanceof AIStructuredOutputError) {
    return {
      type: error.diagnostic.failureType,
      provider: error.diagnostic.provider,
      model: error.diagnostic.model,
      http_status: error.diagnostic.httpStatus,
      finish_reason: error.diagnostic.finishReason,
      content_length: error.diagnostic.contentLength,
    }
  }
  if (error instanceof AIInvalidResponseEnvelopeError) {
    return {
      type: 'invalid_response_envelope',
      provider: error.diagnostic.provider,
      model: error.diagnostic.model,
      http_status: error.diagnostic.httpStatus,
      finish_reason: error.diagnostic.finishReason,
      content_length: error.diagnostic.contentLength,
    }
  }
  if (error instanceof AIDeadlineExceededError) {
    return {
      type: 'deadline_exceeded',
      provider: ref.provider,
      model: ref.model,
      http_status: 0,
      finish_reason: null,
      content_length: 0,
    }
  }
  if (error instanceof AIProviderError) {
    return {
      type: 'provider_error',
      provider: error.provider,
      model: ref.model,
      http_status: error.statusCode,
      finish_reason: null,
      content_length: 0,
      ...(error.retryAfterMs === undefined ? {} : { retry_after_ms: error.retryAfterMs }),
    }
  }
  return {
    type: 'provider_error',
    provider: ref.provider,
    model: ref.model,
    http_status: 0,
    finish_reason: null,
    content_length: 0,
  }
}

export function assertSafeDiagnostic(value: SafeDurableDiagnostic): void {
  const keys = Object.keys(value)
  for (const forbidden of ['raw_prompt', 'raw_response', 'content', 'reasoning']) {
    if (keys.includes(forbidden)) throw new Error(`Unsafe diagnostic key: ${forbidden}`)
  }
}
