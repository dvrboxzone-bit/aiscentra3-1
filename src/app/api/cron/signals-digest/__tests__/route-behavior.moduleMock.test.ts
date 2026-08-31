import assert from 'node:assert/strict'
import { after, before, describe, mock, test } from 'node:test'

interface TestSignal {
  id: string
  title: string
  description: string
  category: string
  created_at: string
  status: 'ACTIVE' | 'PROMOTED' | 'DRAFT' | 'WEAK' | 'DISCARD' | 'FAILED'
}

interface QueryResult {
  data: unknown
  error: null
}

type FetchInput = Parameters<typeof fetch>[0]
type FetchInit = Parameters<typeof fetch>[1]

class FakeDigestDatabase {
  stateLastSentAt: string | null
  readonly signals: TestSignal[]

  constructor(signals: TestSignal[], stateLastSentAt: string | null = null) {
    this.signals = signals
    this.stateLastSentAt = stateLastSentAt
  }

  from(table: string): Record<string, unknown> {
    let statuses: string[] | null = null
    let afterCreatedAt: string | null = null
    let ascending = true
    let limit = Number.POSITIVE_INFINITY
    const query: Record<string, unknown> = {}

    query['select'] = () => query
    query['eq'] = () => query
    query['in'] = (_column: unknown, values: unknown) => {
      statuses = Array.isArray(values) ? values.map(String) : null
      return query
    }
    query['gt'] = (_column: unknown, value: unknown) => {
      afterCreatedAt = String(value)
      return query
    }
    query['order'] = (_column: unknown, options: unknown) => {
      if (options && typeof options === 'object' && 'ascending' in options) {
        ascending = Boolean((options as { ascending: unknown }).ascending)
      }
      return query
    }
    query['limit'] = (value: unknown) => {
      limit = Number(value)
      return query
    }
    query['upsert'] = async (payload: unknown): Promise<QueryResult> => {
      assert.equal(table, 'signal_digest_state')
      assert.ok(payload && typeof payload === 'object' && 'last_sent_at' in payload)
      this.stateLastSentAt = String((payload as { last_sent_at: unknown }).last_sent_at)
      return { data: null, error: null }
    }
    query['maybeSingle'] = async (): Promise<QueryResult> => {
      if (table === 'signal_digest_state') {
        return {
          data: this.stateLastSentAt ? { last_sent_at: this.stateLastSentAt } : null,
          error: null,
        }
      }

      const [first] = this.resolveSignals(statuses, afterCreatedAt, ascending, limit)
      return { data: first ? { created_at: first.created_at } : null, error: null }
    }
    query['then'] = (
      resolve: (value: QueryResult) => unknown,
      reject?: (reason: unknown) => unknown,
    ) =>
      Promise.resolve({
        data: this.resolveSignals(statuses, afterCreatedAt, ascending, limit),
        error: null,
      }).then(resolve, reject)

    return query
  }

  private resolveSignals(
    statuses: string[] | null,
    afterCreatedAt: string | null,
    ascending: boolean,
    limit: number,
  ): TestSignal[] {
    return this.signals
      .filter((signal) => !statuses || statuses.includes(signal.status))
      .filter((signal) => !afterCreatedAt || signal.created_at > afterCreatedAt)
      .sort((left, right) =>
        ascending
          ? left.created_at.localeCompare(right.created_at)
          : right.created_at.localeCompare(left.created_at),
      )
      .slice(0, limit)
  }
}

let activeDatabase = new FakeDigestDatabase([])
const supabaseModuleMock = mock.module('@/lib/supabase/server', {
  namedExports: { createAdminClient: () => activeDatabase },
})
let GET: (request: Request) => Promise<Response>
before(async () => {
  const route = await import('../route')
  GET = route.GET
})
after(() => supabaseModuleMock.restore())

function signal(
  id: string,
  createdAt: string,
  status: TestSignal['status'] = 'ACTIVE',
): TestSignal {
  return {
    id,
    title: `Signal ${id}`,
    description: `Description ${id}`,
    category: 'Models',
    created_at: createdAt,
    status,
  }
}

function configureEnvironment(t: { after: (callback: () => void) => void }): void {
  const names = [
    'CRON_SECRET',
    'RESEND_API_KEY',
    'RESEND_SEGMENT_ALL_SUBSCRIBERS_ID',
    'RESEND_TOPIC_SIGNALS_ID',
  ] as const
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]))

  process.env['CRON_SECRET'] = 'test-cron-secret'
  process.env['RESEND_API_KEY'] = 'test-resend-key'
  process.env['RESEND_SEGMENT_ALL_SUBSCRIBERS_ID'] = 'test-segment'
  process.env['RESEND_TOPIC_SIGNALS_ID'] = 'test-topic'

  t.after(() => {
    for (const name of names) {
      const value = previous[name]
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  })
}

function request(): Request {
  return new Request('https://aiscentra.test/api/cron/signals-digest', {
    headers: { authorization: 'Bearer test-cron-secret' },
  })
}

describe('/api/cron/signals-digest delivery behavior', { concurrency: false }, () => {
  test('first run records the newest public baseline and sends no archived Signals', async (t) => {
    configureEnvironment(t)
    activeDatabase = new FakeDigestDatabase([
      signal('archive-1', '2026-08-01T00:00:00.000Z'),
      signal('archive-2', '2026-08-20T00:00:00.000Z', 'PROMOTED'),
    ])
    const resend = t.mock.method(
      globalThis,
      'fetch',
      async () => new Response(null, { status: 200 }),
    )

    const response = await GET(request())

    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      ok: true,
      sent: false,
      reason: 'baseline_initialized',
    })
    assert.equal(activeDatabase.stateLastSentAt, '2026-08-20T00:00:00.000Z')
    assert.equal(resend.mock.callCount(), 0)
  })

  test('one new public Signal after baseline is sent exactly once', async (t) => {
    configureEnvironment(t)
    activeDatabase = new FakeDigestDatabase(
      [
        signal('archive', '2026-08-20T00:00:00.000Z'),
        signal('new-public', '2026-08-21T00:00:00.000Z'),
      ],
      '2026-08-20T00:00:00.000Z',
    )
    const bodies: Array<Record<string, unknown>> = []
    const resend = t.mock.method(
      globalThis,
      'fetch',
      async (_url: FetchInput, init?: FetchInit) => {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
        return new Response(null, { status: 200 })
      },
    )

    const first = await GET(request())
    const second = await GET(request())

    assert.deepEqual(await first.json(), { ok: true, sent: true, signalCount: 1 })
    assert.deepEqual(await second.json(), {
      ok: true,
      sent: false,
      reason: 'no_new_signals',
    })
    assert.equal(resend.mock.callCount(), 1)
    assert.match(String(bodies[0]?.['html']), /new-public/)
    assert.equal(activeDatabase.stateLastSentAt, '2026-08-21T00:00:00.000Z')
  })

  test('DRAFT, WEAK, DISCARD, and FAILED lifecycle outcomes are never sent', async (t) => {
    configureEnvironment(t)
    activeDatabase = new FakeDigestDatabase(
      [
        signal('draft', '2026-08-21T00:00:00.000Z', 'DRAFT'),
        signal('weak', '2026-08-22T00:00:00.000Z', 'WEAK'),
        signal('discard', '2026-08-23T00:00:00.000Z', 'DISCARD'),
        signal('failed', '2026-08-24T00:00:00.000Z', 'FAILED'),
      ],
      '2026-08-20T00:00:00.000Z',
    )
    const resend = t.mock.method(
      globalThis,
      'fetch',
      async () => new Response(null, { status: 200 }),
    )

    const response = await GET(request())

    assert.deepEqual(await response.json(), {
      ok: true,
      sent: false,
      reason: 'no_new_signals',
    })
    assert.equal(resend.mock.callCount(), 0)
    assert.equal(activeDatabase.stateLastSentAt, '2026-08-20T00:00:00.000Z')
  })

  test('failed email delivery does not advance digest state', async (t) => {
    configureEnvironment(t)
    activeDatabase = new FakeDigestDatabase(
      [signal('new-public', '2026-08-21T00:00:00.000Z')],
      '2026-08-20T00:00:00.000Z',
    )
    const resend = t.mock.method(
      globalThis,
      'fetch',
      async () => new Response('{"message":"fixture rejection"}', { status: 422 }),
    )

    const response = await GET(request())

    assert.equal(response.status, 502)
    assert.deepEqual(await response.json(), {
      ok: false,
      reason: 'resend_broadcast_failed',
    })
    assert.equal(resend.mock.callCount(), 1)
    assert.equal(activeDatabase.stateLastSentAt, '2026-08-20T00:00:00.000Z')
  })

  test('each later run sends at most three public Signals and advances only to the last included one', async (t) => {
    configureEnvironment(t)
    activeDatabase = new FakeDigestDatabase(
      [1, 2, 3, 4].map((day) =>
        signal(`new-${day}`, `2026-08-${String(20 + day).padStart(2, '0')}T00:00:00.000Z`),
      ),
      '2026-08-20T00:00:00.000Z',
    )
    const bodies: Array<Record<string, unknown>> = []
    t.mock.method(globalThis, 'fetch', async (_url: FetchInput, init?: FetchInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      return new Response(null, { status: 200 })
    })

    const first = await GET(request())
    const second = await GET(request())

    assert.deepEqual(await first.json(), { ok: true, sent: true, signalCount: 3 })
    assert.deepEqual(await second.json(), { ok: true, sent: true, signalCount: 1 })
    assert.doesNotMatch(String(bodies[0]?.['html']), /new-4/)
    assert.match(String(bodies[1]?.['html']), /new-4/)
    assert.equal(activeDatabase.stateLastSentAt, '2026-08-24T00:00:00.000Z')
  })
})
