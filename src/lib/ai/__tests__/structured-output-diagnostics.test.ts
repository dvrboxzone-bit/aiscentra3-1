import { afterEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'

import { AIInvalidResponseEnvelopeError, callProvider, callProviderJSON } from '../client'
import { AIStructuredOutputError } from '../structured-output'

const originalFetch = globalThis.fetch
const originalApiKey = process.env['GROQ_API_KEY']
const model = { provider: 'groq' as const, model: 'openai/gpt-oss-20b' }
const schema = z.object({ ok: z.boolean() })
let requestedMaxTokens: number | undefined
let requestedBody: Record<string, unknown> | undefined

afterEach(() => {
  globalThis.fetch = originalFetch
  requestedMaxTokens = undefined
  requestedBody = undefined
  if (originalApiKey === undefined) delete process.env['GROQ_API_KEY']
  else process.env['GROQ_API_KEY'] = originalApiKey
})

function respond(content: string, finishReason: string): void {
  process.env['GROQ_API_KEY'] = 'test-key-not-real'
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> & {
      max_tokens?: number
    }
    requestedBody = body
    requestedMaxTokens = body.max_tokens
    return new Response(
      JSON.stringify({
        choices: [{ message: { content }, finish_reason: finishReason }],
        usage: { total_tokens: 10 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }
}

async function captureFailure(): Promise<AIStructuredOutputError> {
  try {
    await callProviderJSON(
      model,
      [{ role: 'user', content: 'return JSON' }],
      schema,
      { maxTokens: 400 },
      Date.now() + 30_000,
    )
  } catch (error) {
    assert.ok(error instanceof AIStructuredOutputError)
    return error
  }
  assert.fail('expected structured output failure')
}

describe('structured AI diagnostics', () => {
  test('finish_reason=length takes precedence and reports output_truncated without raw content', async () => {
    const raw = '{"private_fragment":'
    respond(raw, 'length')
    const error = await captureFailure()

    assert.deepEqual(error.diagnostic, {
      provider: 'groq',
      model: 'openai/gpt-oss-20b',
      failureType: 'output_truncated',
      httpStatus: 200,
      finishReason: 'length',
      contentLength: raw.length,
    })
    assert.equal(requestedMaxTokens, 400, 'the incident fixture must reproduce the old cap')
    assert.doesNotMatch(error.message, /private_fragment/)
  })

  test('unparseable HTTP 200 content reports json_parse with finish reason and length', async () => {
    const raw = 'not-json-private'
    respond(raw, 'stop')
    const error = await captureFailure()

    assert.equal(error.diagnostic.failureType, 'json_parse')
    assert.equal(error.diagnostic.finishReason, 'stop')
    assert.equal(error.diagnostic.contentLength, raw.length)
    assert.doesNotMatch(error.message, /not-json-private/)
  })

  test('parseable but invalid HTTP 200 content reports schema_validation', async () => {
    const raw = JSON.stringify({ ok: 'not-a-boolean' })
    respond(raw, 'stop')
    const error = await captureFailure()

    assert.equal(error.diagnostic.failureType, 'schema_validation')
    assert.equal(error.diagnostic.finishReason, 'stop')
    assert.equal(error.diagnostic.contentLength, raw.length)
  })

  test('valid HTTP 200 JSON returns normally', async () => {
    respond(JSON.stringify({ ok: true }), 'stop')
    const result = await callProviderJSON(
      model,
      [{ role: 'user', content: 'return JSON' }],
      schema,
      { maxTokens: 400 },
      Date.now() + 30_000,
    )

    assert.deepEqual(result, { ok: true })
  })

  test('structured-output request options reach the provider envelope exactly', async () => {
    respond(JSON.stringify({ ok: true }), 'stop')
    const responseFormat = {
      type: 'json_schema' as const,
      json_schema: {
        name: 'safe_contract',
        strict: true,
        schema: {
          type: 'object',
          properties: { ok: { type: 'boolean' } },
          required: ['ok'],
          additionalProperties: false,
        },
      },
    }

    await callProviderJSON(
      model,
      [{ role: 'user', content: 'return JSON' }],
      schema,
      { maxTokens: 400, responseFormat, reasoningEffort: 'low' },
      Date.now() + 30_000,
    )

    assert.deepEqual(requestedBody?.['response_format'], responseFormat)
    assert.equal(requestedBody?.['reasoning_effort'], 'low')
  })

  test('invalid provider envelope reports safe typed metadata and never retains raw content', async () => {
    process.env['GROQ_API_KEY'] = 'test-key-not-real'
    const privateRaw = JSON.stringify({ private_response_fragment: 'must-not-leak' })
    globalThis.fetch = async () =>
      new Response(privateRaw, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })

    await assert.rejects(
      callProvider(model, [{ role: 'user', content: 'return JSON' }], {}, Date.now() + 30_000),
      (error: unknown) => {
        assert.ok(error instanceof AIInvalidResponseEnvelopeError)
        assert.equal(error.statusCode, 0)
        assert.deepEqual(error.diagnostic, {
          provider: 'groq',
          model: 'openai/gpt-oss-20b',
          failureType: 'invalid_response_envelope',
          httpStatus: 200,
          finishReason: null,
          contentLength: privateRaw.length,
        })
        assert.doesNotMatch(error.message, /must-not-leak|private_response_fragment/)
        assert.doesNotMatch(JSON.stringify(error.diagnostic), /must-not-leak/)
        return true
      },
    )
  })
})
