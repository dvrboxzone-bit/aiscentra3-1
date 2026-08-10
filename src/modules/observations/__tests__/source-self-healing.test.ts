/**
 * AIscentra — source self-healing tests
 *
 * REAL BUG this guards: updateSourceStatus() previously wrote only
 * `status` and `last_checked_at` -- the actual error message (already
 * computed at every call site) was silently dropped, and there was no
 * way to distinguish a source that failed once from one that has been
 * broken for weeks. Confirmed against production: three sources sat in
 * ERROR for ~20 days with metadata={}.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { updateSourceStatus } from '../collector'

function makeMockClient(initialMetadata: Record<string, unknown> | null = {}): {
  client: { from: (table: string) => unknown }
  updates: Array<Record<string, unknown>>
} {
  const updates: Array<Record<string, unknown>> = []

  const client = {
    from: (_table: string) => ({
      select: (_cols: string) => ({
        eq: (_col: string, _val: string) => ({
          single: async () => ({ data: { metadata: initialMetadata }, error: null }),
        }),
      }),
      update: (values: Record<string, unknown>) => ({
        eq: async (_col: string, _val: string) => {
          updates.push(values)
          return { data: null, error: null }
        },
      }),
    }),
  }

  return { client, updates }
}

describe('updateSourceStatus', () => {
  test('ACTIVE resets error metadata and consecutive_errors to 0', async () => {
    const { client, updates } = makeMockClient({ consecutive_errors: 3, last_error: 'boom' })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await updateSourceStatus(client as any, 'src-1', 'ACTIVE')

    assert.equal(updates.length, 1)
    const meta = updates[0]?.['metadata'] as Record<string, unknown>
    assert.equal(meta['consecutive_errors'], 0)
    assert.equal(meta['last_error'], null)
  })

  test('ERROR records the real error message -- previously silently dropped', async () => {
    const { client, updates } = makeMockClient({})
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await updateSourceStatus(client as any, 'src-1', 'ERROR', 'HTTP 503 from feed.example.com')

    const meta = updates[0]?.['metadata'] as Record<string, unknown>
    assert.equal(meta['last_error'], 'HTTP 503 from feed.example.com')
    assert.ok(meta['last_error_at'], 'must record when the error happened')
  })

  test('consecutive_errors increments across repeated failures rather than resetting', async () => {
    const { client, updates } = makeMockClient({ consecutive_errors: 2 })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await updateSourceStatus(client as any, 'src-1', 'ERROR', 'still failing')

    const meta = updates[0]?.['metadata'] as Record<string, unknown>
    assert.equal(meta['consecutive_errors'], 3)
  })

  test('first-ever failure starts consecutive_errors at 1, not undefined/NaN', async () => {
    const { client, updates } = makeMockClient(null)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await updateSourceStatus(client as any, 'src-1', 'ERROR', 'first failure')

    const meta = updates[0]?.['metadata'] as Record<string, unknown>
    assert.equal(meta['consecutive_errors'], 1)
  })

  test('missing error message falls back to a placeholder rather than storing undefined', async () => {
    const { client, updates } = makeMockClient({})
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await updateSourceStatus(client as any, 'src-1', 'ERROR')

    const meta = updates[0]?.['metadata'] as Record<string, unknown>
    assert.equal(meta['last_error'], 'Unknown error')
  })

  test('every call updates last_checked_at, so a source is never mistaken for un-retried', async () => {
    const { client, updates } = makeMockClient({})
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await updateSourceStatus(client as any, 'src-1', 'ERROR', 'x')
    assert.ok(updates[0]?.['last_checked_at'])
  })
})
