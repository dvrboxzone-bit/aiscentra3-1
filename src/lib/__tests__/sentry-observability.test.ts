import assert from 'node:assert/strict'
import { afterEach, describe, test } from 'node:test'

import type { ErrorEvent, EventHint } from '@sentry/nextjs'

import {
  getSentryEnvironment,
  getSentryErrorOnlyOptions,
  getSentryRelease,
  isSentryEnabled,
} from '@/lib/observability/sentry-config'
import {
  captureControlledSentryTestEvent,
  ControlledSentryTestError,
} from '@/lib/observability/sentry-control'
import {
  CONTROLLED_TEST_MESSAGE,
  removeDataAndTracingIntegrations,
  sanitizeSentryEvent,
} from '@/lib/observability/sentry-privacy'
import { handleControlledSentryTest } from '@/app/api/internal/sentry-test/route'

const ENV_KEYS = [
  'NEXT_PUBLIC_SENTRY_DSN',
  'NEXT_PUBLIC_SENTRY_RELEASE',
  'NEXT_PUBLIC_SENTRY_ENVIRONMENT',
  'NEXT_PUBLIC_VERCEL_ENV',
  'VERCEL_GIT_COMMIT_SHA',
  'VERCEL_ENV',
  'GITHUB_SHA',
] as const
const originalEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]]))

afterEach(() => {
  for (const [key, value] of originalEnv) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('Sentry privacy contract', () => {
  test('fail-closed sanitizer removes request, user, AI and domain payloads', () => {
    const event = {
      type: undefined,
      event_id: 'event-id',
      level: 'error',
      message: 'email test@example.com prompt secret Signal body',
      user: { id: 'user-1', email: 'test@example.com', ip_address: '127.0.0.1' },
      tags: { observation: 'observation content' },
      extra: { prompt: 'raw prompt', model_output: 'raw output', signal: 'signal content' },
      contexts: { ai: { reasoning: 'private reasoning' } },
      breadcrumbs: [{ message: 'cookie=secret', data: { authorization: 'Bearer secret' } }],
      request: {
        method: 'POST',
        url: 'https://example.com/api/signals/123?email=test@example.com&prompt=secret',
        headers: { cookie: 'session=secret', authorization: 'Bearer secret' },
        cookies: { session: 'secret' },
        query_string: 'email=test@example.com',
        data: { prompt: 'raw prompt', observation: 'raw observation' },
      },
      exception: {
        values: [
          {
            type: 'ValidationError',
            value: 'model output contained test@example.com',
            stacktrace: {
              frames: [
                {
                  filename: 'https://example.com/src/route.ts?token=secret',
                  function: 'processRequest',
                  lineno: 42,
                  vars: { prompt: 'secret' },
                  pre_context: ['raw signal'],
                  context_line: 'raw observation',
                  post_context: ['raw model output'],
                },
              ],
            },
            mechanism: { type: 'generic', handled: false, data: { body: 'secret' } },
          },
        ],
      },
    } as unknown as ErrorEvent
    const hint = { attachments: [{ filename: 'prompt.txt', data: 'secret' }] } as EventHint

    const sanitized = sanitizeSentryEvent(event, hint)

    assert.deepEqual(sanitized, {
      type: undefined,
      event_id: 'event-id',
      level: 'error',
      message: '[redacted]',
      request: { method: 'POST', url: 'https://example.com/api/signals/:id' },
      exception: {
        values: [
          {
            type: 'ValidationError',
            value: '[redacted]',
            stacktrace: {
              frames: [
                {
                  filename: 'https://example.com/src/route.ts',
                  function: 'processRequest',
                  lineno: 42,
                },
              ],
            },
            mechanism: { type: 'generic', handled: false },
          },
        ],
      },
    })
    assert.equal(hint.attachments?.length, 0)
    assert.equal(JSON.stringify(sanitized).includes('secret'), false)
    assert.equal(JSON.stringify(sanitized).includes('test@example.com'), false)
  })

  test('controlled technical marker is the only preserved event message', () => {
    const sanitized = sanitizeSentryEvent({
      type: undefined,
      message: CONTROLLED_TEST_MESSAGE,
      exception: {
        values: [{ type: 'ControlledSentryTestError', value: CONTROLLED_TEST_MESSAGE }],
      },
    })
    assert.equal(sanitized.message, CONTROLLED_TEST_MESSAGE)
    assert.equal(sanitized.exception?.values?.[0]?.value, CONTROLLED_TEST_MESSAGE)
  })

  test('removes all AI, request-data and performance integrations', () => {
    const names = [
      'GlobalHandlers',
      'Breadcrumbs',
      'RequestData',
      'VercelAI',
      'OpenAI',
      'AnthropicAI',
      'LangChain',
      'Postgres',
    ]
    const integrations = names.map((name) => ({ name, setupOnce() {} }))
    assert.deepEqual(
      removeDataAndTracingIntegrations(integrations).map(({ name }) => name),
      ['GlobalHandlers'],
    )
  })
})

describe('Sentry runtime configuration', () => {
  test('missing DSN disables Sentry without throwing', () => {
    delete process.env['NEXT_PUBLIC_SENTRY_DSN']
    assert.equal(isSentryEnabled(), false)
    const options = getSentryErrorOnlyOptions()
    assert.equal(options.enabled, false)
    assert.equal(options.sendDefaultPii, false)
    assert.equal(options.tracesSampleRate, 0)
    assert.equal(options.enableLogs, false)
    assert.equal(options.beforeSendTransaction?.({} as never, {}), null)
    assert.equal(options.beforeBreadcrumb?.({} as never, {}), null)
  })

  test('release and environment use Vercel build metadata', () => {
    process.env['VERCEL_GIT_COMMIT_SHA'] = '0123456789abcdef0123456789abcdef01234567'
    process.env['VERCEL_ENV'] = 'preview'
    assert.equal(getSentryRelease(), '0123456789abcdef0123456789abcdef01234567')
    assert.equal(getSentryEnvironment(), 'preview')
  })
})

describe('controlled Preview event', () => {
  test('captures only the fixed technical error and flushes once', async () => {
    const captured: Error[] = []
    const outcome = await captureControlledSentryTestEvent({
      enabled: () => true,
      captureException(error) {
        captured.push(error)
        return 'event-id'
      },
      flush: async (timeout) => timeout === 2_000,
    })
    assert.equal(outcome, 'sent')
    assert.equal(captured.length, 1)
    assert.ok(captured[0] instanceof ControlledSentryTestError)
    assert.equal(captured[0]?.message, CONTROLLED_TEST_MESSAGE)
  })

  test('route is Preview-only, CRON_SECRET-protected and accepts no inputs', async () => {
    let captures = 0
    const deps = {
      capture: async () => {
        captures += 1
        return 'sent' as const
      },
      environment: () => 'preview',
      authorize: () => true,
    }
    const withQuery = await handleControlledSentryTest(
      new Request('https://preview.example/api/internal/sentry-test?input=forbidden', {
        method: 'POST',
      }),
      deps,
    )
    assert.equal(withQuery.status, 400)
    assert.equal(captures, 0)

    const response = await handleControlledSentryTest(
      new Request('https://preview.example/api/internal/sentry-test', { method: 'POST' }),
      deps,
    )
    assert.equal(response.status, 202)
    assert.equal(captures, 1)

    const production = await handleControlledSentryTest(
      new Request('https://example.com/api/internal/sentry-test', { method: 'POST' }),
      { ...deps, environment: () => 'production' },
    )
    assert.equal(production.status, 404)
  })
})
