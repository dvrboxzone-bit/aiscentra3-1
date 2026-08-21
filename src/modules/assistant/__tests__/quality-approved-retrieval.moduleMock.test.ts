import { describe, test, mock } from 'node:test'
import assert from 'node:assert/strict'

interface QueryCall {
  table: string
  method: string
  args: unknown[]
}

function makeEmptyQuery(table: string, calls: QueryCall[]): Record<string, unknown> {
  const query: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'in', 'textSearch', 'order', 'limit', 'not', 'overlaps']) {
    query[method] = (...args: unknown[]) => {
      calls.push({ table, method, args })
      return query
    }
  }
  query['then'] = (
    resolve: (value: { data: unknown[]; error: null; count: number }) => unknown,
    reject?: (reason: unknown) => unknown,
  ) => Promise.resolve({ data: [], error: null, count: 0 }).then(resolve, reject)
  return query
}

describe('Assistant quality-approved retrieval', () => {
  test('zero APPROVED Signals returns honest no-evidence and never queries derivative Events/Reports', async (t) => {
    const calls: QueryCall[] = []
    const moduleMock = mock.module('@/lib/supabase/server', {
      namedExports: {
        createClient: async () => ({
          from: (table: string) => {
            calls.push({ table, method: 'from', args: [] })
            return makeEmptyQuery(table, calls)
          },
        }),
      },
    })
    t.after(() => moduleMock.restore())

    const { retrieveContext } = await import('../retrieval')
    const result = await retrieveContext('frontier model release')

    assert.equal(result.hasContext, false)
    assert.deepEqual(result.signals, [])
    assert.deepEqual(result.events, [])
    assert.deepEqual(result.reports, [])
    assert.match(result.contextSummary, /No quality-approved Observatory evidence found/)

    const qualityFilters = calls.filter(
      (call) =>
        call.table === 'signals' &&
        call.method === 'eq' &&
        call.args[0] === 'quality_state' &&
        call.args[1] === 'APPROVED',
    )
    assert.ok(qualityFilters.length >= 3, 'count, FTS and fallback must all require APPROVED')
    assert.equal(
      calls.some((call) => call.table === 'events'),
      false,
    )
    assert.equal(
      calls.some((call) => call.table === 'reports'),
      false,
    )
  })
})
