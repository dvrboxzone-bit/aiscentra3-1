import { afterEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'

import { processBatchOfObservations } from '@/app/api/enrich/batch/route'
import { processObservation } from '../engine'
import type { ObservationRow } from '@/modules/observations/queries'

const savedFetch = globalThis.fetch
const savedGroqKey = process.env['GROQ_API_KEY']
const savedCloudflareToken = process.env['CLOUDFLARE_API_TOKEN']
const savedCloudflareAccount = process.env['CLOUDFLARE_ACCOUNT_ID']

afterEach(() => {
  globalThis.fetch = savedFetch
  if (savedGroqKey === undefined) delete process.env['GROQ_API_KEY']
  else process.env['GROQ_API_KEY'] = savedGroqKey
  if (savedCloudflareToken === undefined) delete process.env['CLOUDFLARE_API_TOKEN']
  else process.env['CLOUDFLARE_API_TOKEN'] = savedCloudflareToken
  if (savedCloudflareAccount === undefined) delete process.env['CLOUDFLARE_ACCOUNT_ID']
  else process.env['CLOUDFLARE_ACCOUNT_ID'] = savedCloudflareAccount
})

function observation(metadata: Record<string, unknown> = {}): ObservationRow {
  return {
    id: 'obs-structured-output-test',
    source_id: 'source-structured-output-test',
    title: 'New Model Release Achieves Record Enterprise Benchmark Results',
    content:
      'A reproducible architecture release changes inference cost and deployment constraints across several enterprise workloads.',
    url: 'https://example.test/evidence',
    published_at: '2026-08-24T00:00:00Z',
    collected_at: '2026-08-24T00:00:00Z',
    metadata,
    processed: false,
    processing_error: null,
    signal_id: null,
  } as unknown as ObservationRow
}

function installProviderHarness(
  responseContent: string,
  finishReason: string,
): {
  signalWrites: string[]
  decisionWrites: Array<Record<string, unknown>>
  observationWrites: Array<Record<string, unknown>>
} {
  process.env['GROQ_API_KEY'] = 'test-key-not-real'
  process.env['CLOUDFLARE_API_TOKEN'] = 'test-token-not-real'
  process.env['CLOUDFLARE_ACCOUNT_ID'] = 'test-account-not-real'

  const signalWrites: string[] = []
  const decisionWrites: Array<Record<string, unknown>> = []
  const observationWrites: Array<Record<string, unknown>> = []

  globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
    const urlText = typeof url === 'string' ? url : url.toString()
    const method = (init?.method ?? 'GET').toUpperCase()
    if (urlText.includes('supabase.co') || urlText.includes('placeholder.supabase')) {
      const body = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {}
      if (urlText.includes('/signals') && (method === 'POST' || method === 'PATCH')) {
        signalWrites.push(method)
      }
      if (urlText.includes('/signal_decision_log') && method === 'POST') {
        decisionWrites.push(body)
      }
      if (urlText.includes('/observations') && method === 'PATCH') {
        observationWrites.push(body)
      }
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })
    }

    return new Response(
      JSON.stringify({
        choices: [{ message: { content: responseContent }, finish_reason: finishReason }],
        usage: { total_tokens: 100 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }

  return { signalWrites, decisionWrites, observationWrites }
}

describe('SIS structured-output lifecycle', () => {
  test('mixed invalid-envelope/truncation chain is retryable and never terminalizes the observation', async () => {
    process.env['GROQ_API_KEY'] = 'test-key-not-real'
    process.env['CLOUDFLARE_API_TOKEN'] = 'test-token-not-real'
    process.env['CLOUDFLARE_ACCOUNT_ID'] = 'test-account-not-real'
    const providerCalls: string[] = []
    const signalWrites: string[] = []
    const decisionWrites: Array<Record<string, unknown>> = []
    const processedWrites: Array<{ id: string }> = []
    const retryWrites: Array<{ id: string; metadata: Record<string, unknown> }> = []
    const privateEnvelopeFragment = 'private-envelope-content-must-not-leak'

    globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
      const urlText = typeof url === 'string' ? url : url.toString()
      const method = (init?.method ?? 'GET').toUpperCase()
      if (urlText.includes('supabase.co') || urlText.includes('placeholder.supabase')) {
        const body = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {}
        if (urlText.includes('/signals') && (method === 'POST' || method === 'PATCH')) {
          signalWrites.push(method)
        }
        if (urlText.includes('/signal_decision_log') && method === 'POST') {
          decisionWrites.push(body)
        }
        return new Response('[]', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }

      const requestBody = JSON.parse(String(init?.body ?? '{}')) as { model?: string }
      const requestedModel = requestBody.model ?? 'unknown'
      providerCalls.push(requestedModel)
      if (requestedModel === 'openai/gpt-oss-120b') {
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"truncated":' }, finish_reason: 'length' }],
            usage: { total_tokens: 400 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response(JSON.stringify({ privateEnvelopeFragment }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }

    const stats = await processBatchOfObservations([observation()], Date.now() + 120_000, {
      fetchSourceInfo: async () => ({
        ok: true,
        trustScore: 0.8,
        sourceName: 'Fixture Source',
      }),
      fetchObservationsPage: async () => ({ rows: [], error: null, pool: 'fresh' }),
      processObservation,
      markObservationProcessed: async (id) => {
        processedWrites.push({ id })
        return { ok: true }
      },
      markObservationForRetry: async (id, _delay, _client, metadata) => {
        retryWrites.push({ id, metadata: metadata ?? {} })
        return id
      },
      sleep: async () => undefined,
    })

    assert.deepEqual(providerCalls, [
      'openai/gpt-oss-20b',
      'openai/gpt-oss-120b',
      '@cf/zai-org/glm-4.7-flash',
    ])
    assert.equal(stats.attempted, 1)
    assert.equal(stats.retried, 1)
    assert.equal(stats.failed, 0)
    assert.equal(stats.stopped_reason, 'structured_output_retry')
    assert.equal(processedWrites.length, 0)
    assert.equal(signalWrites.length, 0)
    assert.equal(decisionWrites.length, 0)
    assert.equal(retryWrites.length, 1)
    assert.equal(retryWrites[0]?.metadata['structured_output_attempt'], 2)
    const audit = JSON.stringify(retryWrites[0]?.metadata)
    assert.match(audit, /output_truncated/)
    assert.match(audit, /invalid_response_envelope/)
    assert.match(audit, /"http_status":200/)
    assert.doesNotMatch(audit, new RegExp(privateEnvelopeFragment))
  })

  test('HTTP 200 + finish_reason=length is typed, bounded-retried, remains unprocessed, and writes no Signal/decision', async () => {
    const rawFragmentThatMustNotLeak = '{"secret_raw_fragment":'
    const harness = installProviderHarness(rawFragmentThatMustNotLeak, 'length')
    const processedWrites: Array<{ id: string }> = []
    const retryWrites: Array<{
      id: string
      delay: number
      metadata: Record<string, unknown>
    }> = []

    const stats = await processBatchOfObservations([observation()], Date.now() + 120_000, {
      fetchSourceInfo: async () => ({
        ok: true,
        trustScore: 0.8,
        sourceName: 'Fixture Source',
      }),
      fetchObservationsPage: async () => ({ rows: [], error: null, pool: 'fresh' }),
      processObservation,
      markObservationProcessed: async (id) => {
        processedWrites.push({ id })
        return { ok: true }
      },
      markObservationForRetry: async (id, delay, _client, metadata) => {
        retryWrites.push({ id, delay: delay ?? 0, metadata: metadata ?? {} })
        return id
      },
      sleep: async () => undefined,
    })

    assert.equal(stats.attempted, 1)
    assert.equal(stats.retried, 1)
    assert.equal(stats.failed, 0)
    assert.equal(stats.stopped_reason, 'structured_output_retry')
    assert.equal(stats.error_breakdown.output_truncated, 1)
    assert.equal(processedWrites.length, 0, 'truncation must never mark the observation processed')
    assert.equal(retryWrites.length, 1)
    assert.equal(retryWrites[0]?.metadata['structured_output_attempt'], 2)
    assert.equal(harness.signalWrites.length, 0)
    assert.equal(harness.decisionWrites.length, 0)
    assert.doesNotMatch(
      JSON.stringify(retryWrites[0]?.metadata),
      new RegExp(rawFragmentThatMustNotLeak.replace(/[{}]/g, '\\$&')),
      'raw model content must not enter retry diagnostics',
    )
  })

  test('HTTP 200 + valid SIS JSON continues to a real explicit low-SIS decision', async () => {
    const payload = {
      sis_novelty: 0,
      sis_importance: 0,
      sis_urgency: 0,
      sis_confidence: 1,
      anti_hype_score: 5,
      engine_justification:
        'This is normal incremental engineering without ecosystem-level consequences.',
    }
    const harness = installProviderHarness(JSON.stringify(payload), 'stop')

    const result = await processObservation(
      observation(),
      0.8,
      'Fixture Source',
      '',
      Date.now() + 120_000,
    )

    assert.equal(result.outcome, 'rejected_low_sis')
    assert.equal(harness.decisionWrites.length, 1)
    assert.equal(harness.decisionWrites[0]?.['rejection_code'], 'R-09')
    assert.equal(harness.signalWrites.length, 0)
  })

  test('terminal schema failure writes an explicit R-16 ERROR decision with typed diagnostics', async () => {
    const invalidPayload = JSON.stringify({
      sis_novelty: 5,
      sis_importance: 5,
      sis_urgency: 5,
      sis_confidence: 5,
      anti_hype_score: 5,
      engine_justification: 'short',
    })
    const harness = installProviderHarness(invalidPayload, 'stop')

    const result = await processObservation(
      observation(),
      0.8,
      'Fixture Source',
      '',
      Date.now() + 120_000,
    )

    assert.equal(result.outcome, 'error')
    assert.match(result.reason ?? '', /schema_validation/)
    assert.equal(harness.signalWrites.length, 0)
    assert.equal(harness.decisionWrites.length, 1)
    assert.equal(harness.decisionWrites[0]?.['decision'], 'ERROR')
    assert.equal(harness.decisionWrites[0]?.['rejection_code'], 'R-16')
    assert.match(String(harness.decisionWrites[0]?.['engine_justification']), /schema_validation/)
    assert.ok(
      harness.observationWrites.some(
        (write) => write['rejection_code'] === 'R-16' && write['qualification_result'] === 'ERROR',
      ),
    )
    assert.doesNotMatch(JSON.stringify(harness.decisionWrites), /engine_justification":"short/)
  })

  test('third truncated attempt terminates with R-16 instead of retrying forever', async () => {
    const harness = installProviderHarness('{"partial":', 'length')

    const result = await processObservation(
      observation({ structured_output_attempt: 3 }),
      0.8,
      'Fixture Source',
      '',
      Date.now() + 120_000,
    )

    assert.equal(result.outcome, 'error')
    assert.match(result.reason ?? '', /output_truncated; attempt=3/)
    assert.equal(harness.decisionWrites.length, 1)
    assert.equal(harness.decisionWrites[0]?.['rejection_code'], 'R-16')
  })
})
