import type { StructuredOutputFailureType } from './structured-output'

export type SafeAIExecutionDiagnosticKind =
  | 'model_contract'
  | 'provider_error'
  | 'backoff'
  | 'tpm_wait'
  | 'deadline_exceeded'

/**
 * Deliberately count/metadata-only. Prompt text, response content and provider
 * response bodies have no representable field in this contract.
 */
export interface SafeAIExecutionDiagnostic {
  kind: SafeAIExecutionDiagnosticKind
  stage: string
  provider?: string
  model?: string
  httpStatus?: number
  failureType?: StructuredOutputFailureType
  finishReason?: string | null
  contentLength?: number
  contentEmpty?: boolean
  retryAttempt?: number
  retryAfterMs?: number
  backoffMs?: number
  tpmWaitMs?: number
  tpmUsedTokens?: number
  tpmLimitTokens?: number
  remainingMs?: number
  requiredMs?: number
}

export function structuredFailureTypesFromExecutionDiagnostics(
  diagnostics: readonly SafeAIExecutionDiagnostic[],
): StructuredOutputFailureType[] {
  return [
    ...new Set(
      diagnostics.flatMap((diagnostic) =>
        diagnostic.failureType === undefined ? [] : [diagnostic.failureType],
      ),
    ),
  ]
}
