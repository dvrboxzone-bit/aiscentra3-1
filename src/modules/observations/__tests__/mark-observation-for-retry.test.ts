/**
 * AIscentra — markObservationForRetry Tests
 *
 * Uses the optional injectable `RetryQueryClient` parameter (added
 * purely for testability -- every real call site omits it and gets the
 * real createAdminClient()) to drive markObservationForRetry through a
 * hand-written mock covering the exact two query shapes it uses:
 * a metadata read, then an update+select. No real Supabase connection
 * involved.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { markObservationForRetry, type RetryQueryClient } from '../queries'

interface MockConfig {
  readData?: { metadata: Record<string, unknown> | null } | null
  readError?: { message: string } | null
  updateData?: Array<{ id: string }> | null
  updateError?: { message: string } | null
}

function makeMockClient(config: MockConfig): {
  client: RetryQueryClient
  capturedUpdate: { values?: Record<string, unknown> }
} {
  const capturedUpdate: { values?: Record<string, unknown> } = {}

  const client: RetryQueryClient = {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: config.readData ?? null,
            error: config.readError ?? null,
          }),
        }),
      }),
      update: (values: Record<string, unknown>) => {
        capturedUpdate.values = values
        return {
          eq: () => ({
            select: async () => ({
              data: config.updateData ?? null,
              error: config.updateError ?? null,
            }),
          }),
        }
      },
    }),
  }

  return { client, capturedUpdate }
}

describe('markObservationForRetry', () => {
  test('successful requeue preserves existing metadata and adds retry_after', async () => {
    const { client, capturedUpdate } = makeMockClient({
      readData: { metadata: { feed_url: 'https://example.com/feed.xml', other_field: 42 } },
      updateData: [{ id: 'obs-1' }],
    })

    const confirmedId = await markObservationForRetry('obs-1', 60_000, client)

    assert.equal(confirmedId, 'obs-1')
    assert.ok(capturedUpdate.values, 'update() must have been called')
    const metadata = capturedUpdate.values?.['metadata'] as Record<string, unknown>
    assert.equal(
      metadata['feed_url'],
      'https://example.com/feed.xml',
      'existing metadata field must survive',
    )
    assert.equal(metadata['other_field'], 42, 'existing metadata field must survive')
    assert.ok(typeof metadata['retry_after'] === 'string', 'retry_after must be added')
  })

  test('successful requeue sets processed=false and processing_error=null', async () => {
    const { client, capturedUpdate } = makeMockClient({
      readData: { metadata: {} },
      updateData: [{ id: 'obs-2' }],
    })

    await markObservationForRetry('obs-2', 60_000, client)

    assert.equal(capturedUpdate.values?.['processed'], false)
    assert.equal(capturedUpdate.values?.['processing_error'], null)
  })

  test('handles a null (never-set) existing metadata column without throwing', async () => {
    const { client, capturedUpdate } = makeMockClient({
      readData: { metadata: null },
      updateData: [{ id: 'obs-3' }],
    })

    await markObservationForRetry('obs-3', 60_000, client)
    const metadata = capturedUpdate.values?.['metadata'] as Record<string, unknown>
    assert.ok(typeof metadata['retry_after'] === 'string')
  })

  test('a Supabase read error throws, with no update ever attempted', async () => {
    const { client, capturedUpdate } = makeMockClient({
      readError: { message: 'connection reset' },
    })

    await assert.rejects(
      markObservationForRetry('obs-4', 60_000, client),
      /failed to read existing metadata/,
    )
    assert.equal(
      capturedUpdate.values,
      undefined,
      'update must never be attempted if the read failed',
    )
  })

  test('a Supabase update error throws', async () => {
    const { client } = makeMockClient({
      readData: { metadata: {} },
      updateError: { message: 'constraint violation' },
    })

    await assert.rejects(markObservationForRetry('obs-5', 60_000, client), /failed to requeue/)
  })

  test('an update that matches zero rows throws (not treated as success)', async () => {
    const { client } = makeMockClient({
      readData: { metadata: {} },
      updateData: [], // Supabase itself does not error on this -- 0 rows matched
    })

    await assert.rejects(
      markObservationForRetry('obs-does-not-exist', 60_000, client),
      /matched zero rows/,
    )
  })

  test('an update returning null data (not an empty array) also throws', async () => {
    const { client } = makeMockClient({
      readData: { metadata: {} },
      updateData: null,
    })

    await assert.rejects(markObservationForRetry('obs-6', 60_000, client), /matched zero rows/)
  })
})
