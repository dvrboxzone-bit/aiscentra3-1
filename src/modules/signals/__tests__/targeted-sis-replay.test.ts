import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { POST } from '@/app/api/internal/sis-replay/route'
import type { ObservationRow } from '@/modules/observations/queries'
import {
  parseTargetedReplayRequest,
  runTargetedSisReplay,
  TARGETED_SIS_REPAIR_KEY,
  TARGETED_SIS_REPLAY_ALLOWLIST,
  TARGETED_SIS_REPLAY_KEY,
  type TargetedReplayItemResult,
} from '@/modules/signals/targeted-sis-replay'

const NOW = Date.parse('2026-08-24T12:00:00.000Z')

function observation(id: string, metadata: Record<string, unknown> = {}): ObservationRow {
  return {
    id,
    source_id: `source-${id}`,
    title: 'Targeted SIS replay fixture',
    content: 'Offline fixture content',
    url: 'https://example.test/fixture',
    published_at: '2026-08-23T00:00:00.000Z',
    collected_at: '2026-08-23T00:00:00.000Z',
    metadata: {
      repair_key: TARGETED_SIS_REPAIR_KEY,
      retry_after: '2026-08-24T00:00:00.000Z',
      ...metadata,
    },
    processed: false,
    processing_error: null,
    signal_id: null,
    rejection_code: null,
  } as unknown as ObservationRow
}

describe('targeted SIS replay', () => {
  test('requires CRON_SECRET before body parsing or privileged access', async () => {
    const savedSecret = process.env['CRON_SECRET']
    delete process.env['CRON_SECRET']
    try {
      const response = await POST(
        new Request('https://example.test/api/internal/sis-replay', { method: 'POST' }),
      )
      assert.equal(response.status, 401)
      assert.deepEqual(await response.json(), { error: 'Unauthorized' })
    } finally {
      if (savedSecret === undefined) delete process.env['CRON_SECRET']
      else process.env['CRON_SECRET'] = savedSecret
    }
  })

  test('server-side allowlist contains exactly the nine repaired observation IDs', () => {
    assert.deepEqual(TARGETED_SIS_REPLAY_ALLOWLIST, [
      'e4275483-39e4-4441-84a2-0a1df546cf07',
      'ec86e548-8394-4c45-8353-7ba588f23cf3',
      'fc22b35a-776b-4666-aabc-64ea1a198c34',
      'bcf826e4-069c-4627-a4ab-6635ce3e1f7e',
      '5e0938e3-feb2-4531-9ebb-1e53164d219d',
      'cb043c56-7be5-4e9d-9144-2c9c407d9655',
      '91c78285-f310-4dfa-a0ca-0953e8cfdd40',
      '948419ea-27e9-4213-b692-f80c04611cfa',
      'de90407c-d4b9-4eee-862f-12a549f9544d',
    ])
  })

  test('rejects a request containing a foreign observation ID before any processing', async () => {
    const parsed = parseTargetedReplayRequest({
      observationIds: ['00000000-0000-4000-8000-000000000001'],
    })
    assert.deepEqual(parsed, {
      ok: false,
      error: 'One or more observationIds are not allowlisted',
    })
  })

  test('processes exactly nine allowlisted rows once and never calls a general batch loader', async () => {
    const rows = TARGETED_SIS_REPLAY_ALLOWLIST.map((id) => observation(id))
    const claimed = new Set<string>()
    const attempted: string[] = []

    const summary = await runTargetedSisReplay(TARGETED_SIS_REPLAY_ALLOWLIST, NOW + 120_000, {
      loadEligible: async (ids) => {
        assert.deepEqual(ids, TARGETED_SIS_REPLAY_ALLOWLIST)
        return rows
      },
      claim: async (row) => {
        if (claimed.has(row.id)) return null
        claimed.add(row.id)
        return observation(row.id, { targeted_sis_replay_key: TARGETED_SIS_REPLAY_KEY })
      },
      processOne: async (row): Promise<TargetedReplayItemResult> => {
        attempted.push(row.id)
        return { disposition: 'valid' }
      },
      now: () => NOW,
    })

    assert.deepEqual(attempted, TARGETED_SIS_REPLAY_ALLOWLIST)
    assert.deepEqual(summary, {
      requested: 9,
      eligible: 9,
      attempted: 9,
      valid: 9,
      rejected: 0,
      retried: 0,
      failed: 0,
      diagnostic_counts: { json_parse: 0, schema_validation: 0, output_truncated: 0 },
      complete: true,
    })
  })

  test('internal route never invokes the general batch endpoint or queue cycle', () => {
    const source = readFileSync(resolve('src/app/api/internal/sis-replay/route.ts'), 'utf8')
    assert.doesNotMatch(source, /fetch\s*\(\s*['"`]\/api\/enrich\/batch/)
    assert.doesNotMatch(source, /runEnrichmentCycle\s*\(/)
    assert.match(source, /General observation queue access is forbidden/)
  })

  test('a second successful invocation has zero eligible IDs', async () => {
    const replayedRows = TARGETED_SIS_REPLAY_ALLOWLIST.map((id) =>
      observation(id, { targeted_sis_replay_key: TARGETED_SIS_REPLAY_KEY }),
    )
    let processCalls = 0

    const summary = await runTargetedSisReplay(TARGETED_SIS_REPLAY_ALLOWLIST, NOW + 120_000, {
      loadEligible: async () => replayedRows,
      claim: async () => {
        throw new Error('claim must not run for already replayed rows')
      },
      processOne: async () => {
        processCalls++
        return { disposition: 'failed' }
      },
      now: () => NOW,
    })

    assert.equal(processCalls, 0)
    assert.equal(summary.eligible, 0)
    assert.equal(summary.attempted, 0)
    assert.equal(summary.complete, true)
  })

  test('a failed claim makes the invocation incomplete instead of reporting success', async () => {
    const id = TARGETED_SIS_REPLAY_ALLOWLIST[0]
    const summary = await runTargetedSisReplay([id], NOW + 120_000, {
      loadEligible: async () => [observation(id)],
      claim: async () => null,
      processOne: async () => {
        throw new Error('process must not run without a durable claim')
      },
      now: () => NOW,
    })

    assert.equal(summary.eligible, 1)
    assert.equal(summary.attempted, 0)
    assert.equal(summary.complete, false)
  })

  test('aggregates dispositions and typed structured-output diagnostics', async () => {
    const results: TargetedReplayItemResult[] = [
      { disposition: 'valid' },
      { disposition: 'rejected', diagnostic: 'schema_validation' },
      { disposition: 'retried', diagnostic: 'output_truncated' },
      { disposition: 'failed', diagnostic: 'json_parse' },
    ]
    const ids = TARGETED_SIS_REPLAY_ALLOWLIST.slice(0, results.length)

    const summary = await runTargetedSisReplay(ids, NOW + 120_000, {
      loadEligible: async () => ids.map((id) => observation(id)),
      claim: async (row) => row,
      processOne: async () => {
        const result = results.shift()
        if (!result) throw new Error('fixture result exhausted')
        return result
      },
      now: () => NOW,
    })

    assert.equal(summary.attempted, 4)
    assert.equal(summary.valid, 1)
    assert.equal(summary.rejected, 1)
    assert.equal(summary.retried, 1)
    assert.equal(summary.failed, 1)
    assert.deepEqual(summary.diagnostic_counts, {
      json_parse: 1,
      schema_validation: 1,
      output_truncated: 1,
    })
  })
})
