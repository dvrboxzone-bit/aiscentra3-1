import { test } from 'node:test'
import assert from 'node:assert/strict'
import { guardEnrichmentExecution } from '../enrichment-execution'

test('only literal true admits enrichment; false and unavailable state fail closed', async () => {
  assert.equal(await guardEnrichmentExecution(async () => true), null)
  const disabled = await guardEnrichmentExecution(async () => false)
  assert.equal(disabled?.status, 200)
  assert.deepEqual(await disabled?.json(), { skipped: true, reason: 'execution_disabled' })
  for (const state of [null, undefined, 'true', 1, {}]) {
    assert.equal((await guardEnrichmentExecution(async () => state))?.status, 503)
  }
  const failure = await guardEnrichmentExecution(async () => {
    throw new Error('private')
  })
  assert.equal(failure?.status, 503)
  assert.equal((await failure?.text())?.includes('private'), false)
})

test('real route boundaries: auth first; disabled/error perform only control SELECT, never mutations/providers', async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://placeholder.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key-placeholder'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-placeholder'
  process.env.ADMIN_EMAIL = 'admin@placeholder.test'
  const oldSecret = process.env.CRON_SECRET
  process.env.CRON_SECRET = 'test-only-enrichment-secret'
  const originalFetch = globalThis.fetch
  try {
    const routes = [
      (await import('@/app/api/enrich/route')).POST,
      (await import('@/app/api/enrich/batch/route')).POST,
      (await import('@/app/api/internal/sis-replay/route')).POST,
      (await import('@/app/api/cron/enrich/route')).GET,
    ]
    for (const route of routes) {
      for (const state of ['disabled', 'error', 'enabled'] as const) {
        const calls: string[] = []
        globalThis.fetch = async (input, init) => {
          const url = String(input)
          calls.push(url)
          if (url.includes('/sis_execution_controls?')) {
            assert.equal(init?.method ?? 'GET', 'GET')
            assert.ok(url.includes('control_key=eq.durable_sis_v1_control_20260825'))
            return new Response(
              JSON.stringify(
                state === 'error'
                  ? { message: 'unavailable' }
                  : { execution_enabled: state === 'enabled' },
              ),
              {
                status: state === 'error' ? 400 : 200,
                headers: { 'Content-Type': 'application/json' },
              },
            )
          }
          // Enabled batch hits its existing lock, but does not acquire it.
          if (url.includes('/rpc/acquire_execution_lock')) return new Response('false')
          // Enabled single-item route finds an empty queue.
          if (url.includes('/observations?')) return new Response('null')
          throw new Error(`Unexpected downstream call: ${new URL(url).pathname}`)
        }
        const unauthorized = await route(
          new Request('https://test.invalid/api', { method: 'POST' }),
        )
        assert.equal(unauthorized.status, 401)
        assert.equal(calls.length, 0)
        const response = await route(
          new Request('https://test.invalid/api', {
            method: 'POST',
            headers: {
              'x-cron-secret': 'test-only-enrichment-secret',
              authorization: 'Bearer test-only-enrichment-secret',
            },
            body: '{}',
          }),
        )
        if (state !== 'enabled') {
          assert.equal(response.status, state === 'disabled' ? 200 : 503)
          assert.deepEqual(await response.json(), {
            skipped: true,
            reason: state === 'disabled' ? 'execution_disabled' : 'execution_state_unavailable',
          })
          assert.equal(calls.length, 1, 'zero lock, queue, ledger, metrics, engine/provider calls')
        } else {
          assert.ok([200, 400].includes(response.status))
          assert.ok(calls[0]?.includes('/sis_execution_controls?'))
        }
      }
    }
  } finally {
    globalThis.fetch = originalFetch
    if (oldSecret === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = oldSecret
  }
})
