import type { ProviderName } from './config'

export type StructuredOutputFailureType =
  | 'json_parse'
  | 'schema_validation'
  | 'output_truncated'
  | 'invalid_response_envelope'

export interface StructuredOutputDiagnostic {
  provider: ProviderName
  model: string
  failureType: StructuredOutputFailureType
  httpStatus: number
  finishReason: string | null
  contentLength: number
  contentEmpty?: boolean
}

/**
 * A provider returned HTTP 200, but its structured output was not usable.
 * Deliberately stores metadata only: raw model content must never be logged
 * or persisted through this error contract.
 */
export class AIStructuredOutputError extends Error {
  constructor(public readonly diagnostic: StructuredOutputDiagnostic) {
    super(
      `Structured output failure: type=${diagnostic.failureType}, provider=${diagnostic.provider}, model=${diagnostic.model}, http_status=${diagnostic.httpStatus}, finish_reason=${diagnostic.finishReason ?? 'null'}, content_length=${diagnostic.contentLength}`,
    )
    this.name = 'AIStructuredOutputError'
  }
}

/** All provider fallbacks returned unusable structured output. */
export class AIStructuredOutputChainError extends Error {
  public readonly failureType: StructuredOutputFailureType
  public readonly retryable: boolean

  constructor(
    public readonly diagnostics: readonly StructuredOutputDiagnostic[],
    public readonly role: string,
  ) {
    const failureType: StructuredOutputFailureType = diagnostics.some(
      (item) => item.failureType === 'output_truncated',
    )
      ? 'output_truncated'
      : diagnostics.some((item) => item.failureType === 'invalid_response_envelope')
        ? 'invalid_response_envelope'
        : diagnostics.some((item) => item.failureType === 'schema_validation')
          ? 'schema_validation'
          : 'json_parse'
    const summary = diagnostics
      .map(
        (item) =>
          `${item.provider}/${item.model}:${item.failureType}:http=${item.httpStatus}:finish=${item.finishReason ?? 'null'}:chars=${item.contentLength}`,
      )
      .join(', ')
    super(`All models returned unusable structured output for role=${role} (${summary})`)
    this.name = 'AIStructuredOutputChainError'
    this.failureType = failureType
    this.retryable =
      failureType === 'output_truncated' || failureType === 'invalid_response_envelope'
  }
}

export const STRUCTURED_OUTPUT_MAX_ATTEMPTS = 3
export const STRUCTURED_OUTPUT_RETRY_BASE_MS = 60_000

export function getStructuredOutputAttempt(metadata: Record<string, unknown>): number {
  const stored = metadata['structured_output_attempt']
  if (typeof stored !== 'number' || !Number.isInteger(stored) || stored < 1) return 1
  return Math.min(stored, STRUCTURED_OUTPUT_MAX_ATTEMPTS)
}

export function structuredOutputRetryDelayMs(currentAttempt: number): number {
  const normalized = Math.max(1, Math.min(currentAttempt, STRUCTURED_OUTPUT_MAX_ATTEMPTS - 1))
  return STRUCTURED_OUTPUT_RETRY_BASE_MS * 2 ** (normalized - 1)
}

export function diagnosticsForAudit(
  diagnostics: readonly StructuredOutputDiagnostic[],
): Array<Record<string, string | number | boolean | null>> {
  return diagnostics.map((item) => ({
    provider: item.provider,
    model: item.model,
    failure_type: item.failureType,
    http_status: item.httpStatus,
    finish_reason: item.finishReason,
    content_length: item.contentLength,
    ...(item.contentEmpty === undefined ? {} : { content_empty: item.contentEmpty }),
  }))
}
