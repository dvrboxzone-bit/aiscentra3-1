import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { parse as parseYaml } from 'yaml'

import {
  DURABLE_SIS_V1_CONTROL_ID,
  assertSafeDiagnostic,
  budgetReservationFor,
  invokeOneProvider,
  nextModel,
} from '../durable-sis-v1'

test('control is fixed to the approved observation and preserves separate provider units', () => {
  assert.equal(DURABLE_SIS_V1_CONTROL_ID, 'e4275483-39e4-4441-84a2-0a1df546cf07')
  const messages = [{ role: 'user' as const, content: 'classify this observation' }]
  assert.equal(
    budgetReservationFor(messages, { provider: 'groq', model: 'openai/gpt-oss-20b' }).unitKind,
    'groq_tokens',
  )
  assert.deepEqual(
    budgetReservationFor(messages, {
      provider: 'cloudflare',
      model: '@cf/zai-org/glm-4.7-flash',
    }),
    { unitKind: 'provider_request', units: 1 },
  )
})

test('one failed stage advances exactly one model and diagnostics reject raw fields', () => {
  const chain = [
    { provider: 'groq' as const, model: '20b' },
    { provider: 'groq' as const, model: '120b' },
    { provider: 'cloudflare' as const, model: 'cf' },
  ]
  const [first, second, third] = chain
  assert.ok(first && second && third)
  assert.deepEqual(nextModel(chain, first), second)
  assert.deepEqual(nextModel(chain, second), third)
  assert.equal(nextModel(chain, third), null)
  assert.doesNotThrow(() =>
    assertSafeDiagnostic({
      type: 'output_truncated',
      provider: 'groq',
      model: '120b',
      http_status: 200,
      finish_reason: 'length',
      content_length: 0,
    }),
  )
})

test('one queue delivery invokes exactly one provider attempt', async () => {
  let calls = 0
  const value = await invokeOneProvider(async () => {
    calls += 1
    return 'typed-result'
  })
  assert.equal(value, 'typed-result')
  assert.equal(calls, 1)
})

test('migration uses durable read/visibility, never pop, and installs disabled kill switch', () => {
  const sql = readFileSync(
    'supabase/migrations/20260825121411_add_durable_sis_v1_pgmq_control.sql',
    'utf8',
  )
  assert.match(sql, /pgmq\.read\('durable_sis_v1', p_visibility_seconds, 1\)/)
  assert.doesNotMatch(sql, /pgmq\.pop/i)
  assert.match(sql, /execution_enabled boolean not null default false/i)
  assert.match(sql, /if coalesce\(v_enabled, false\) is false then[\s\S]*status='PAUSED'/i)
  assert.match(sql, /unit_kind = 'groq_tokens'/)
  assert.match(sql, /unit_kind = 'provider_request'/)
  assert.match(sql, /perform pgmq\.archive[\s\S]*select pgmq\.send/)
  assert.match(sql, /observation already finalized/)
  assert.match(sql, /v_attempt\.status not in \('QUEUED','RUNNING'\)/)
  assert.match(sql, /select \* into v_existing[\s\S]*if found then return[\s\S]*run not ready/)
})

test('manual workflow is bounded, one environment, and cannot call batch/replay/cron', () => {
  const workflow = readFileSync('.github/workflows/targeted-sis-durable-v1-control.yml', 'utf8')
  const parsed = parseYaml(workflow) as Record<string, unknown>
  assert.equal(typeof parsed, 'object')
  assert.match(workflow, /workflow_dispatch:\s*$/m)
  assert.doesNotMatch(workflow, /schedule:|inputs:/)
  assert.match(workflow, /environment: production/)
  assert.match(workflow, /group: enrich-batch/)
  assert.equal((workflow.match(/--retry 0/g) ?? []).length, 2)
  assert.match(workflow, /for pass in 1 2 3 4 5 6 7 8 9 10 11 12/)
  assert.match(workflow, /api\/internal\/sis-durable-control\/start/)
  assert.match(workflow, /api\/internal\/sis-durable-control\/stage/)
  assert.doesNotMatch(workflow, /api\/enrich\/batch|api\/internal\/sis-replay|api\/cron\//)
})

test('production schema gate requires PGMQ and every durable SIS contract', () => {
  const gate = readFileSync('scripts/release/schema-check.sql', 'utf8')
  for (const object of [
    'pgmq',
    'durable_sis_v1',
    'sis_execution_controls',
    'sis_execution_runs',
    'sis_execution_attempts',
    'sis_provider_budget_reservations',
    'sis_execution_finalizations',
    'claim_durable_sis_v1_attempt',
    'finalize_durable_sis_v1',
  ]) {
    assert.match(gate, new RegExp(object))
  }
})
