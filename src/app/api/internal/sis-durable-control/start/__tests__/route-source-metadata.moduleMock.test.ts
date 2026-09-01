import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

test('real source type reaches the Durable SIS start payload without fallback', async (t) => {
  const sourceSelects: string[] = []
  const reservations: string[] = []
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = []

  const lockMock = mock.module('@/lib/ai/execution-lock', {
    namedExports: {
      acquireEnrichmentLock: async () => true,
      releaseEnrichmentLock: async () => true,
    },
  })
  const modelsMock = mock.module('@/lib/ai/models', {
    namedExports: {
      getModelChain: () => [{ provider: 'groq', model: 'classifier-primary' }],
    },
  })
  const guardMock = mock.module('@/lib/security/cron-guard', {
    namedExports: { isAuthorizedCronRequest: () => true },
  })
  const durableMock = mock.module('@/modules/signals/durable-sis-v1', {
    namedExports: {
      budgetReservationFor: (messages: Array<{ content: string }>) => {
        reservations.push(messages[1]?.content ?? '')
        return { unitKind: 'groq_tokens', units: 123 }
      },
    },
  })

  const observation = {
    id: 'e4275483-39e4-4441-84a2-0a1df546cf07',
    source_id: '44444444-4444-4444-4444-444444444444',
    title: 'Control observation',
    content: 'Verified primary evidence',
  }
  const source = {
    name: 'ArXiv CS.AI',
    type: 'research',
    status: 'ACTIVE',
    url: 'https://arxiv.org/list/cs.AI/recent',
  }
  const db = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args })
      return { data: { status: 'QUEUED', started: true }, error: null }
    },
    from: (table: string) => ({
      select: (columns: string) => {
        if (table === 'sources') sourceSelects.push(columns)
        return {
          eq: () => ({
            single: async () => ({
              data: table === 'observations' ? observation : source,
              error: null,
            }),
          }),
        }
      },
    }),
  }
  const supabaseMock = mock.module('@/lib/supabase/server', {
    namedExports: { createAdminClient: () => db },
  })
  t.after(() => {
    supabaseMock.restore()
    durableMock.restore()
    guardMock.restore()
    modelsMock.restore()
    lockMock.restore()
  })

  const { POST } = await import('../route')
  const response = await POST(
    new Request('https://aiscentra.test/api/internal/sis-durable-control/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ observation_id: observation.id }),
    }),
  )

  assert.equal(response.status, 200)
  assert.deepEqual(sourceSelects, ['name,type,status,url'])
  assert.match(reservations[0] ?? '', /SOURCE: ArXiv CS\.AI \(research\)/)
  assert.doesNotMatch(reservations[0] ?? '', /Unknown Source/)
  assert.deepEqual(rpcCalls, [
    {
      name: 'start_durable_sis_v1_control',
      args: {
        p_observation_id: observation.id,
        p_provider: 'groq',
        p_model: 'classifier-primary',
        p_units: 123,
        p_unit_kind: 'groq_tokens',
      },
    },
  ])
})
