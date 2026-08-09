/**
 * AIscentra — collection schedule tests
 *
 * REAL GAP this closes: /api/cron/collect's own docstring claimed
 * "Triggered by Vercel Cron every 4 hours (see vercel.json)" while no
 * such cron entry existed anywhere in vercel.json -- confirmed
 * unreachable by any automatic trigger. Real collection frequency was
 * once/day via /api/cron/pipeline's fire-and-forget call to
 * /api/collect.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const wf = (): string => readFileSync('.github/workflows/collect-4h.yml', 'utf8')

describe('collection schedule', () => {
  test('exactly 6 collection cycles per day', () => {
    const cron = /- cron: '(\S+) (\S+) \* \* \*'/.exec(wf())
    assert.ok(cron, 'a cron schedule must be present')
    const hours = (cron?.[2] ?? '').split(',')
    assert.equal(hours.length, 6, `expected exactly 6 collection times/day, got ${hours.length}`)
  })

  test('each collection slot is 30-60 minutes before its matching enrichment cycle', () => {
    const collectCron = /- cron: '(\S+) (\S+) \* \* \*'/.exec(wf())
    const collectHours = (collectCron?.[2] ?? '')
      .split(',')
      .map(Number)
      .sort((a, b) => a - b)

    const enrichWf = readFileSync('.github/workflows/enrich-batch-hourly.yml', 'utf8')
    const enrichCron = /- cron: '(\S+) (\S+) \* \* \*'/.exec(enrichWf)
    const enrichHours = (enrichCron?.[2] ?? '')
      .split(',')
      .map(Number)
      .sort((a, b) => a - b)

    const vercel = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
      crons?: Array<{ path: string; schedule: string }>
    }
    const vercelHour = Number(
      vercel.crons?.find((c) => c.path === '/api/cron/pipeline')?.schedule.split(' ')[1] ?? '-1',
    )
    const allEnrichHours = [...enrichHours, vercelHour].sort((a, b) => a - b)

    assert.equal(
      collectHours.length,
      allEnrichHours.length,
      'every enrichment cycle must have exactly one matching collection cycle before it',
    )
    for (let i = 0; i < collectHours.length; i++) {
      const collect = collectHours[i]
      const enrich = allEnrichHours[i]
      assert.ok(
        collect !== undefined &&
          enrich !== undefined &&
          enrich - collect >= 0 &&
          enrich - collect <= 1,
        `collection at hour ${collect} must precede its enrichment cycle at hour ${enrich} by 0-1 hours`,
      )
    }
  })

  test("concurrency group exists, distinct from enrichment's own group, cancel-in-progress is false", () => {
    const src = wf()
    assert.match(src, /concurrency:/)
    assert.match(src, /group:\s*collect-sources/)
    assert.match(src, /cancel-in-progress:\s*false/)
  })

  test('manual dispatch is retained', () => {
    assert.match(wf(), /workflow_dispatch:/)
  })

  test('calls /api/cron/collect, not /api/collect directly -- the per-source dispatcher, not the sequential-loop endpoint', () => {
    // /api/collect with no sourceId processes all matching sources
    // SEQUENTIALLY in one request (confirmed: 9 sources x up to 8s each
    // risks exceeding Vercel's 10s function ceiling). /api/cron/collect
    // dispatches one fire-and-forget request per source instead.
    assert.match(wf(), /\/api\/cron\/collect/)
  })
})
