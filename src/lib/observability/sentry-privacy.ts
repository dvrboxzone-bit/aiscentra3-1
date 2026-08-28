import type { ErrorEvent, EventHint } from '@sentry/nextjs'

const REDACTED = '[redacted]'
const CONTROLLED_TEST_MESSAGE = 'SENTRY_CONTROLLED_TECHNICAL_TEST_V1'

const AI_INTEGRATION_NAMES = new Set([
  'AnthropicAI',
  'GoogleGenAI',
  'LangChain',
  'LangGraph',
  'OpenAI',
  'VercelAI',
])

const DATA_BEARING_INTEGRATION_NAMES = new Set([
  'Breadcrumbs',
  'Http',
  'RequestData',
  'Prisma',
  'Postgres',
  'PostgresJs',
  'Supabase',
])

function sanitizeUrl(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value, 'https://sentry.invalid')
    const pathname = url.pathname
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi, ':id')
      .replace(/\/[0-9]+(?=\/|$)/g, '/:id')
    return url.origin === 'https://sentry.invalid' ? pathname : `${url.origin}${pathname}`
  } catch {
    return undefined
  }
}

function safeSymbol(value: string | undefined, fallback: string): string {
  return value && /^[A-Za-z_$][\w.$-]{0,100}$/.test(value) ? value : fallback
}

function sanitizeException(event: ErrorEvent): ErrorEvent['exception'] {
  if (!event.exception?.values) return undefined
  return {
    values: event.exception.values.map((value) => ({
      type: safeSymbol(value.type, 'Error'),
      value: value.value === CONTROLLED_TEST_MESSAGE ? CONTROLLED_TEST_MESSAGE : REDACTED,
      ...(value.stacktrace
        ? {
            stacktrace: {
              frames: (value.stacktrace.frames ?? []).map((frame) => ({
                ...(frame.filename ? { filename: sanitizeUrl(frame.filename) ?? REDACTED } : {}),
                ...(frame.function ? { function: safeSymbol(frame.function, REDACTED) } : {}),
                ...(frame.module ? { module: safeSymbol(frame.module, REDACTED) } : {}),
                ...(frame.lineno !== undefined ? { lineno: frame.lineno } : {}),
                ...(frame.colno !== undefined ? { colno: frame.colno } : {}),
                ...(frame.in_app !== undefined ? { in_app: frame.in_app } : {}),
              })),
            },
          }
        : {}),
      ...(value.mechanism
        ? {
            mechanism: {
              type: safeSymbol(value.mechanism.type, 'generic'),
              ...(value.mechanism.handled !== undefined
                ? { handled: value.mechanism.handled }
                : {}),
            },
          }
        : {}),
    })),
  }
}

/**
 * Fail-closed event sanitizer. Technical classification and stack locations
 * remain useful, while request/user/application payloads never leave AIscentra.
 */
export function sanitizeSentryEvent(event: ErrorEvent, hint?: EventHint): ErrorEvent {
  if (hint?.attachments) hint.attachments.length = 0
  const requestUrl = sanitizeUrl(event.request?.url)
  const exception = sanitizeException(event)

  return {
    type: undefined,
    ...(event.event_id ? { event_id: event.event_id } : {}),
    ...(event.timestamp !== undefined ? { timestamp: event.timestamp } : {}),
    ...(event.platform ? { platform: safeSymbol(event.platform, 'javascript') } : {}),
    ...(event.level ? { level: event.level } : {}),
    ...(event.release ? { release: event.release } : {}),
    ...(event.environment ? { environment: event.environment } : {}),
    ...(event.dist ? { dist: event.dist } : {}),
    ...(event.message
      ? {
          message: event.message === CONTROLLED_TEST_MESSAGE ? CONTROLLED_TEST_MESSAGE : REDACTED,
        }
      : {}),
    ...(exception ? { exception } : {}),
    ...(event.request
      ? {
          request: {
            ...(event.request.method ? { method: event.request.method } : {}),
            ...(requestUrl ? { url: requestUrl } : {}),
          },
        }
      : {}),
    ...(event.transaction ? { transaction: sanitizeUrl(event.transaction) ?? REDACTED } : {}),
  }
}

export function dropSentryBreadcrumb(): null {
  return null
}

export function dropSentryTransaction(): null {
  return null
}

export function removeDataAndTracingIntegrations<T extends { name: string }>(
  integrations: T[],
): T[] {
  return integrations.filter(
    ({ name }) =>
      !AI_INTEGRATION_NAMES.has(name) &&
      !DATA_BEARING_INTEGRATION_NAMES.has(name) &&
      !/(anthropic|google.*gen.*ai|langchain|langgraph|openai|vercel.*ai)/i.test(name),
  )
}

export { CONTROLLED_TEST_MESSAGE }
