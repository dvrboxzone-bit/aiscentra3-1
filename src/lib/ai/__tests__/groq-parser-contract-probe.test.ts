import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { parse as parseYaml } from 'yaml'
import { AIProviderError } from '@/lib/ai/client'
import {
  DURABLE_SIS_V1_PARSER_JSON_SCHEMA,
  DURABLE_SIS_V1_PARSER_MAX_TOKENS,
} from '@/modules/signals/durable-sis-parser-contract'
import {
  SYNTHETIC_PARSER_MESSAGES,
  runGroqParserContractProbe,
  safeProbeDiagnostic,
} from '../../../../scripts/diagnostics/groq-parser-contract-probe'

test('manual probe workflow is one-call, owner-only and isolated from production data systems', () => {
  const workflowText = readFileSync('.github/workflows/groq-parser-contract-probe.yml', 'utf8')
  const workflow = parseYaml(workflowText) as Record<string, unknown>
  const triggers = workflow['on'] as Record<string, unknown>

  assert.deepEqual(Object.keys(triggers), ['workflow_dispatch'])
  assert.match(workflowText, /test "\$ACTOR_NAME" = "\$OWNER_NAME"/)
  assert.match(workflowText, /GROQ_API_KEY: \$\{\{ secrets\.GROQ_API_KEY \}\}/)
  assert.match(workflowText, /BLOCKED: GROQ_API_KEY is unavailable/)
  assert.equal((workflowText.match(/groq-parser-contract-probe\.ts/g) ?? []).length, 1)
  assert.doesNotMatch(
    workflowText,
    /curl|retry|supabase|pgmq|vercel|signal|decision|observation_id/i,
  )
})

test('synthetic probe sends the exact durable parser request contract once', async () => {
  const originalFetch = globalThis.fetch
  const originalKey = process.env['GROQ_API_KEY']
  const apiKey = 'test-only-groq-key-that-must-never-appear'
  let calls = 0
  let body: Record<string, unknown> | undefined

  process.env['GROQ_API_KEY'] = apiKey
  globalThis.fetch = async (_input, init) => {
    calls += 1
    body = JSON.parse(String(init?.body)) as Record<string, unknown>
    return new Response(
      JSON.stringify({
        error: {
          code: 'invalid_request_error',
          type: 'invalid_request_error',
          message: `Invalid schema for response_format. prompt=${SYNTHETIC_PARSER_MESSAGES[1]?.content}; authorization=Bearer ${apiKey}`,
        },
      }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    )
  }

  try {
    await assert.rejects(runGroqParserContractProbe, (error: unknown) => {
      const diagnostic = safeProbeDiagnostic(error)
      assert.deepEqual(diagnostic?.http_status, 400)
      assert.deepEqual(diagnostic?.error?.code, 'invalid_request_error')
      assert.deepEqual(diagnostic?.error?.type, 'invalid_request_error')
      const serialized = JSON.stringify(diagnostic)
      const message = diagnostic?.error?.message ?? ''
      assert.doesNotMatch(serialized, new RegExp(apiKey, 'i'))
      assert.doesNotMatch(serialized, /Synthetic compiler benchmark|authorization=|Bearer/i)
      assert.ok(message.length > 0 && message.length <= 400)
      return true
    })
  } finally {
    globalThis.fetch = originalFetch
    if (originalKey === undefined) delete process.env['GROQ_API_KEY']
    else process.env['GROQ_API_KEY'] = originalKey
  }

  assert.equal(calls, 1)
  assert.equal(body?.['model'], 'openai/gpt-oss-120b')
  assert.equal(body?.['max_tokens'], DURABLE_SIS_V1_PARSER_MAX_TOKENS)
  assert.equal(body?.['temperature'], 0)
  assert.equal(body?.['reasoning_effort'], 'low')
  assert.deepEqual(body?.['messages'], SYNTHETIC_PARSER_MESSAGES)
  assert.deepEqual(body?.['response_format'], {
    type: 'json_schema',
    json_schema: {
      name: 'durable_sis_v1_parser',
      strict: true,
      schema: DURABLE_SIS_V1_PARSER_JSON_SCHEMA,
    },
  })
})

test('probe exposes only status on success and blocks non-4xx failures', () => {
  assert.equal(safeProbeDiagnostic(new Error('network failed')), null)
  assert.equal(safeProbeDiagnostic(new AIProviderError('server', 'groq', 500)), null)
})
