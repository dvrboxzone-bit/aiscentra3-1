import assert from 'node:assert/strict'
import { after, before, mock, test } from 'node:test'

const statusFilters: Array<{ table: string; values: string[] }> = []

function queryFor(table: string): Record<string, unknown> {
  let countQuery = false
  const query: Record<string, unknown> = {}
  query['select'] = (_columns: unknown, options?: { count?: string; head?: boolean }) => {
    countQuery = options?.count === 'exact' && options.head === true
    return query
  }
  query['order'] = () => query
  query['eq'] = () => query
  query['gte'] = () => query
  query['range'] = () => query
  query['limit'] = () => query
  query['in'] = (_column: unknown, values: unknown) => {
    statusFilters.push({ table, values: Array.isArray(values) ? values.map(String) : [] })
    return query
  }
  query['then'] = (
    resolve: (result: { data: unknown[]; count: number | null; error: null }) => unknown,
    reject?: (reason: unknown) => unknown,
  ) =>
    Promise.resolve({
      data: [],
      count: countQuery ? 0 : null,
      error: null,
    }).then(resolve, reject)
  return query
}

const supabaseMock = mock.module('@/lib/supabase/server', {
  namedExports: {
    createClient: async () => ({ from: (table: string) => queryFor(table) }),
  },
})

let getSignals: () => Promise<unknown[]>
let getSignalsCount: () => Promise<number>

before(async () => {
  const queries = await import('../queries')
  getSignals = queries.getSignals
  getSignalsCount = queries.getSignalsCount
})
after(() => supabaseMock.restore())

test('public Signal list and count select only ACTIVE and PROMOTED lifecycle states', async () => {
  await getSignals()
  await getSignalsCount()

  assert.deepEqual(statusFilters, [
    { table: 'signals', values: ['ACTIVE', 'PROMOTED'] },
    { table: 'signals', values: ['ACTIVE', 'PROMOTED'] },
  ])
})
