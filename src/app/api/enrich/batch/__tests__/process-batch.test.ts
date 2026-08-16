/**
 * AIscentra — enrich/batch route: processBatchOfObservations Tests
 *
 * Exercises the extracted, injectable-dependency core loop (points 7-8
 * of the task this was written for: "after deadline, batch stops and
 * the next observation is not processed"; "same honest behavior for
 * 429") with a fixed, hand-built observation list -- no real Supabase
 * connection, no mocking of the SELECT query itself.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { processBatchOfObservations, runEnrichmentCycle, type BatchProcessingDeps } from '../route'
import { AIDeadlineExceededError } from '@/lib/ai/deadline'
import { AITokenBudgetExceededError } from '@/lib/ai/budget-gate'
import { AIProviderError } from '@/lib/ai/client'
import { AIRequestTooLargeError } from '@/lib/ai/tpm-manager'
import type { ObservationRow } from '@/modules/observations/queries'

function makeObservation(id: string): ObservationRow {
  return {
    id,
    source_id: 'source-1',
    title: `Observation ${id}`,
    content: 'Some content',
    url: 'https://example.com',
    published_at: '2026-08-01T00:00:00Z',
    collected_at: '2026-08-01T00:00:00Z',
    metadata: {},
    processed: false,
    processing_error: null,
    signal_id: null,
  } as unknown as ObservationRow
}

function makeDeps(overrides: Partial<BatchProcessingDeps> = {}): {
  deps: BatchProcessingDeps
  calls: { processObservation: string[]; markProcessed: string[]; markForRetry: string[] }
} {
  const calls = {
    processObservation: [] as string[],
    markProcessed: [] as string[],
    markForRetry: [] as string[],
  }

  const deps: BatchProcessingDeps = {
    fetchSourceInfo: async () => ({ ok: true, trustScore: 0.8, sourceName: 'Test Source' }),
    fetchObservationsPage: async () => ({ rows: [], error: null, pool: 'old' }),
    processObservation: (async (obs: ObservationRow) => {
      calls.processObservation.push(obs.id)
      return { observationId: obs.id, outcome: 'signal_created', signalId: 'sig-1' }
    }) as BatchProcessingDeps['processObservation'],
    markObservationProcessed: (async (id: string) => {
      calls.markProcessed.push(id)
      return { ok: true }
    }) as BatchProcessingDeps['markObservationProcessed'],
    markObservationForRetry: (async (id: string) => {
      calls.markForRetry.push(id)
      return id
    }) as BatchProcessingDeps['markObservationForRetry'],
    sleep: async () => {}, // no real waiting in tests
    ...overrides,
  }

  return { deps, calls }
}

describe('processBatchOfObservations', () => {
  test('after a deadline hit on the first observation, the batch stops and the second observation is never attempted', async () => {
    const obs1 = makeObservation('obs-1')
    const obs2 = makeObservation('obs-2')
    const processedIds: string[] = []

    const { deps, calls } = makeDeps({
      processObservation: (async (obs: ObservationRow) => {
        processedIds.push(obs.id)
        if (obs.id === 'obs-1') {
          throw new AIDeadlineExceededError('deadline hit', 'test-context', Date.now())
        }
        return { observationId: obs.id, outcome: 'signal_created', signalId: 'sig-1' }
      }) as BatchProcessingDeps['processObservation'],
    })

    const deadlineAt = Date.now() + 30_000 // generous -- the deadline failure is injected via the mock, not real timing
    const stats = await processBatchOfObservations([obs1, obs2], deadlineAt, deps)

    assert.deepEqual(processedIds, ['obs-1'], 'obs-2 must never have been attempted')
    assert.equal(stats.stopped_reason, 'deadline_exceeded')
    assert.equal(stats.retried, 1)
    assert.equal(stats.attempted, 1)
    assert.deepEqual(calls.markForRetry, ['obs-1'])
  })

  test('after a 429 rate-limit on the first observation, the batch stops and the second observation is never attempted (honest, matching deadline behavior)', async () => {
    const obs1 = makeObservation('obs-1')
    const obs2 = makeObservation('obs-2')

    const { deps, calls } = makeDeps({
      processObservation: (async (obs: ObservationRow) => {
        if (obs.id === 'obs-1') {
          throw new AIProviderError('rate limited', 'groq', 429, 5_000)
        }
        return { observationId: obs.id, outcome: 'signal_created', signalId: 'sig-1' }
      }) as BatchProcessingDeps['processObservation'],
    })

    const deadlineAt = Date.now() + 30_000
    const stats = await processBatchOfObservations([obs1, obs2], deadlineAt, deps)

    assert.equal(stats.stopped_reason, 'rate_limited')
    assert.equal(stats.retried, 1)
    assert.equal(stats.attempted, 1)
    assert.deepEqual(calls.markForRetry, ['obs-1'])
    // obs-2's processObservation must never have been called -- confirmed
    // via markProcessed never being invoked for it (processObservation
    // itself doesn't record calls in this variant, so this is the
    // observable proxy: obs-2 was neither processed nor retried).
    assert.ok(!calls.markProcessed.includes('obs-2'))
    assert.ok(!calls.markForRetry.includes('obs-2'))
  })

  test('a requeue failure after a deadline hit does not report retried++, uses requeue_failed, and still stops the batch', async () => {
    const obs1 = makeObservation('obs-1')
    const obs2 = makeObservation('obs-2')
    const processedIds: string[] = []

    const { deps, calls } = makeDeps({
      processObservation: (async (obs: ObservationRow) => {
        processedIds.push(obs.id)
        if (obs.id === 'obs-1') {
          throw new AIDeadlineExceededError('deadline hit', 'test-context', Date.now())
        }
        return { observationId: obs.id, outcome: 'signal_created', signalId: 'sig-1' }
      }) as BatchProcessingDeps['processObservation'],
      markObservationForRetry: (async () => {
        throw new Error('simulated Supabase update failure')
      }) as BatchProcessingDeps['markObservationForRetry'],
    })

    const deadlineAt = Date.now() + 30_000
    const stats = await processBatchOfObservations([obs1, obs2], deadlineAt, deps)

    assert.equal(stats.stopped_reason, 'requeue_failed')
    assert.equal(
      stats.retried,
      0,
      'retried must NOT be incremented when the requeue write itself failed',
    )
    assert.equal(stats.error_breakdown.requeue_failed, 1)
    assert.deepEqual(
      processedIds,
      ['obs-1'],
      'obs-2 must never have been attempted after the requeue failure',
    )
    void calls
  })

  test('all observations succeed normally when nothing fails', async () => {
    const obs1 = makeObservation('obs-1')
    const obs2 = makeObservation('obs-2')
    const { deps, calls } = makeDeps()

    const deadlineAt = Date.now() + 30_000
    const stats = await processBatchOfObservations([obs1, obs2], deadlineAt, deps)

    assert.equal(stats.stopped_reason, 'queue_empty')
    assert.equal(stats.attempted, 2)
    assert.equal(stats.succeeded, 2)
    assert.deepEqual(calls.processObservation, ['obs-1', 'obs-2'])
  })

  test('after a budget refusal on the first observation, the batch requeues it, stops, and the second observation is never processed', async () => {
    const obs1 = makeObservation('obs-1')
    const obs2 = makeObservation('obs-2')
    const processedIds: string[] = []

    const { deps, calls } = makeDeps({
      processObservation: (async (obs: ObservationRow) => {
        processedIds.push(obs.id)
        if (obs.id === 'obs-1') {
          throw new AITokenBudgetExceededError(
            '[budget] signal_engine refused for llama-3.3-70b-versatile: reserve_exhausted',
            'llama-3.3-70b-versatile',
            'signal_engine',
            {
              allowed: false,
              usedTokens: 100_000,
              ceilingTokens: 100_000,
              reason: 'reserve_exhausted',
            },
          )
        }
        return { observationId: obs.id, outcome: 'signal_created', signalId: 'sig-1' }
      }) as BatchProcessingDeps['processObservation'],
    })

    const deadlineAt = Date.now() + 30_000
    const stats = await processBatchOfObservations([obs1, obs2], deadlineAt, deps)

    assert.deepEqual(
      processedIds,
      ['obs-1'],
      'obs-2 must never be processed after obs-1 was refused by the budget gate -- no Groq call for it can have happened',
    )
    assert.equal(stats.stopped_reason, 'budget_exhausted')
    assert.equal(stats.retried, 1, 'obs-1 must be requeued, not permanently failed')
    assert.equal(
      stats.attempted,
      1,
      'obs-1 WAS genuinely attempted (processObservation ran and threw this specific error) -- honest contract: attempted = succeeded + rejected + failed + retried',
    )
    assert.deepEqual(calls.markForRetry, ['obs-1'], 'obs-1 must go through the normal requeue path')
    assert.equal(
      stats.error_breakdown.budget_exhausted,
      1,
      'the dedicated budget_exhausted counter must increment',
    )
  })

  test('a requeue failure after a budget refusal does not report retried++, uses requeue_failed, and still stops the batch', async () => {
    const obs1 = makeObservation('obs-1')
    const obs2 = makeObservation('obs-2')
    const processedIds: string[] = []

    const { deps, calls } = makeDeps({
      processObservation: (async (obs: ObservationRow) => {
        processedIds.push(obs.id)
        if (obs.id === 'obs-1') {
          throw new AITokenBudgetExceededError(
            'refused',
            'llama-3.3-70b-versatile',
            'signal_engine',
            {
              allowed: false,
              usedTokens: 100_000,
              ceilingTokens: 100_000,
              reason: 'reserve_exhausted',
            },
          )
        }
        return { observationId: obs.id, outcome: 'signal_created', signalId: 'sig-1' }
      }) as BatchProcessingDeps['processObservation'],
      markObservationForRetry: (async () => {
        throw new Error('simulated Supabase update failure')
      }) as BatchProcessingDeps['markObservationForRetry'],
    })

    const deadlineAt = Date.now() + 30_000
    const stats = await processBatchOfObservations([obs1, obs2], deadlineAt, deps)

    assert.equal(stats.stopped_reason, 'requeue_failed')
    assert.equal(
      stats.retried,
      0,
      'retried must NOT be incremented when the requeue write itself failed',
    )
    assert.equal(stats.error_breakdown.requeue_failed, 1)
    assert.deepEqual(
      processedIds,
      ['obs-1'],
      'obs-2 must never have been attempted after the requeue failure',
    )
    void calls
  })
})

describe('merge-blocker regression: source-read failure requeues without fabricated defaults', () => {
  test('a genuine Source read failure (ok:false) requeues the observation, never scores it against a fabricated trustScore/sourceName', async () => {
    const processedObs: Array<{ id: string; trustScore: number; sourceName: string }> = []
    const { deps, calls } = makeDeps({
      fetchSourceInfo: async () => ({
        ok: false,
        trustScore: 0,
        sourceName: '',
        error: 'connection reset',
      }),
      processObservation: (async (obs: ObservationRow, trustScore: number, sourceName: string) => {
        processedObs.push({ id: obs.id, trustScore, sourceName })
        return { observationId: obs.id, outcome: 'signal_created', signalId: 'sig-1' }
      }) as BatchProcessingDeps['processObservation'],
    })

    const obs1 = makeObservation('obs-1')
    const deadlineAt = Date.now() + 30_000
    const stats = await processBatchOfObservations([obs1], deadlineAt, deps)

    assert.equal(
      processedObs.length,
      0,
      'processObservation must never be called with a fabricated trustScore/sourceName after a real source-read failure',
    )
    assert.deepEqual(
      calls.markForRetry,
      ['obs-1'],
      'the observation must be requeued, not silently processed',
    )
    assert.equal(stats.retried, 1)
    assert.equal(stats.stopped_reason, 'source_read_failed')
    assert.equal(stats.error_breakdown.database, 1)
  })

  test('a genuine Source read failure that ALSO fails to requeue is honestly reported as requeue_failed, not retried', async () => {
    const { deps, calls } = makeDeps({
      fetchSourceInfo: async () => ({
        ok: false,
        trustScore: 0,
        sourceName: '',
        error: 'connection reset',
      }),
      markObservationForRetry: (async () => {
        throw new Error('requeue write also failed')
      }) as BatchProcessingDeps['markObservationForRetry'],
    })

    const obs1 = makeObservation('obs-1')
    const stats = await processBatchOfObservations([obs1], Date.now() + 30_000, deps)

    assert.equal(
      stats.retried,
      0,
      'retried must not be incremented when the requeue write itself failed',
    )
    assert.equal(stats.stopped_reason, 'requeue_failed')
    assert.equal(stats.error_breakdown.requeue_failed, 1)
    void calls
  })
})

describe('merge-blocker regression: markObservationProcessed write failure is never counted as a successful processed item', () => {
  test('a genuine write failure requeues the observation instead of incrementing stats.processed', async () => {
    const { deps, calls } = makeDeps({
      markObservationProcessed: (async () => ({
        ok: false,
        writeError: 'connection reset',
      })) as BatchProcessingDeps['markObservationProcessed'],
    })

    const obs1 = makeObservation('obs-1')
    const stats = await processBatchOfObservations([obs1], Date.now() + 30_000, deps)

    assert.equal(
      stats.succeeded,
      0,
      'a write that never actually landed in the database must NEVER be counted as a successful outcome',
    )
    assert.equal(
      stats.attempted,
      1,
      'the observation WAS genuinely attempted (AI processing ran) -- honest contract: attempted = succeeded + rejected + failed + retried',
    )
    assert.deepEqual(
      calls.markForRetry,
      ['obs-1'],
      'the observation must be requeued so the next cycle re-attempts both processing and the write',
    )
    assert.equal(stats.retried, 1)
    assert.equal(stats.stopped_reason, 'write_failed')
    assert.equal(stats.error_breakdown.database, 1)
  })

  test('a write failure that ALSO fails to requeue is honestly reported, never silently treated as success', async () => {
    const { deps } = makeDeps({
      markObservationProcessed: (async () => ({
        ok: false,
        writeError: 'connection reset',
      })) as BatchProcessingDeps['markObservationProcessed'],
      markObservationForRetry: (async () => {
        throw new Error('requeue write also failed')
      }) as BatchProcessingDeps['markObservationForRetry'],
    })

    const obs1 = makeObservation('obs-1')
    const stats = await processBatchOfObservations([obs1], Date.now() + 30_000, deps)

    assert.equal(
      stats.attempted,
      1,
      'the observation was genuinely attempted, even though the requeue itself failed',
    )
    assert.equal(
      stats.failed,
      1,
      'requeue-write failure: attempted+1, failed+1, retried+0 per the honest metrics contract',
    )
    assert.equal(stats.retried, 0)
    assert.equal(stats.stopped_reason, 'requeue_failed')
    assert.equal(stats.error_breakdown.requeue_failed, 1)
  })
})

describe('merge-blocker regression: a genuine queue-read failure is honestly reported as queue_read_failed, never masked as queue_empty', () => {
  test('runEnrichmentCycle: a real fetchObservationsPage error stops the cycle with stopped_reason "queue_read_failed", never processes an observation, and never calls markObservationProcessed/markObservationForRetry for anything', async () => {
    const { deps, calls } = makeDeps({
      fetchObservationsPage: async () => ({ rows: [], error: 'connection reset', pool: 'old' }),
    })

    const stats = await runEnrichmentCycle(Date.now() + 30_000, deps)

    assert.equal(
      stats.stopped_reason,
      'queue_read_failed',
      'a genuine observations-page fetch error must set stopped_reason to queue_read_failed, not leave it at the default queue_empty',
    )
    assert.notEqual(
      stats.stopped_reason,
      'queue_empty',
      'the error must not be masked as an empty queue',
    )
    assert.deepEqual(
      calls.processObservation,
      [],
      'no observation was even fetched -- processObservation must never run',
    )
    assert.deepEqual(
      calls.markProcessed,
      [],
      'markObservationProcessed must never be called -- nothing was fetched to process',
    )
    assert.deepEqual(
      calls.markForRetry,
      [],
      'markObservationForRetry must never be called for an observation that was never even fetched',
    )
    assert.equal(
      stats.attempted,
      0,
      'a failed queue-read cycle happens BEFORE any observation is fetched -- attempted must be 0 per the honest metrics contract',
    )
    assert.equal(stats.retried, 0)
  })

  test('runEnrichmentCycle: a genuinely empty queue (no error) still correctly reports queue_empty, distinguishing it from a real read failure', async () => {
    const { deps } = makeDeps({
      fetchObservationsPage: async () => ({ rows: [], error: null, pool: 'old' }),
    })

    const stats = await runEnrichmentCycle(Date.now() + 30_000, deps)

    assert.equal(stats.stopped_reason, 'queue_empty')
  })
})

describe('merge-blocker regression: a real AIRequestTooLargeError thrown by processObservation reaches the batch handler and triggers a controlled requeue', () => {
  test('processBatchOfObservations: markObservationForRetry called exactly once for the observation, markObservationProcessed never called, honest stats, second observation never attempted', async () => {
    const { deps, calls } = makeDeps({
      processObservation: (async (obs: ObservationRow) => {
        calls.processObservation.push(obs.id)
        throw new AIRequestTooLargeError(
          "estimated request exceeds this model's entire TPM budget",
          'llama-3.1-8b-instant',
          5140,
          5100,
        )
      }) as BatchProcessingDeps['processObservation'],
    })

    const obs1 = makeObservation('obs-1')
    const obs2 = makeObservation('obs-2')
    const stats = await processBatchOfObservations([obs1, obs2], Date.now() + 30_000, deps)

    assert.deepEqual(
      calls.markForRetry,
      ['obs-1'],
      'markObservationForRetry must be called exactly once, for obs-1',
    )
    assert.deepEqual(
      calls.markProcessed,
      [],
      'markObservationProcessed must never be called for a physically-too-large request',
    )
    assert.equal(stats.retried, 1)
    assert.equal(stats.attempted, 1)
    assert.equal(stats.stopped_reason, 'request_too_large')
    assert.equal(stats.error_breakdown.request_too_large, 1)
    assert.deepEqual(
      calls.processObservation,
      ['obs-1'],
      'obs-2 must never be attempted after the batch stops',
    )
  })

  test('processBatchOfObservations: AIRequestTooLargeError whose requeue write ALSO fails is honestly reported as requeue_failed, never counted as retried', async () => {
    const { deps, calls } = makeDeps({
      processObservation: (async (obs: ObservationRow) => {
        calls.processObservation.push(obs.id)
        throw new AIRequestTooLargeError('too large', 'llama-3.1-8b-instant', 5140, 5100)
      }) as BatchProcessingDeps['processObservation'],
      markObservationForRetry: (async () => {
        throw new Error('requeue write also failed')
      }) as BatchProcessingDeps['markObservationForRetry'],
    })

    const obs1 = makeObservation('obs-1')
    const stats = await processBatchOfObservations([obs1], Date.now() + 30_000, deps)

    assert.equal(
      stats.retried,
      0,
      'retried must not be incremented when the requeue write itself failed',
    )
    assert.equal(stats.attempted, 1)
    assert.equal(stats.stopped_reason, 'requeue_failed')
    assert.equal(stats.error_breakdown.requeue_failed, 1)
    void calls
  })
})

describe('merge-blocker regression: runEnrichmentCycle is fail-closed -- the outer loop stops immediately on ANY terminal reason, never overwrites it by fetching another page', () => {
  // REAL BUG this closes: the outer loop's own stop condition
  // previously recognized only 4 of the 8 real terminal
  // stopped_reason values (rate_limited, deadline_exceeded,
  // budget_exhausted, requeue_failed) -- request_too_large,
  // source_read_failed, write_failed, and time_budget all silently
  // fell through, letting the loop fetch ANOTHER page. If that page
  // happened to be empty, the real terminal reason was overwritten to
  // 'queue_empty'. Each test below drives runEnrichmentCycle itself
  // (not processBatchOfObservations in isolation) through the REAL
  // outer loop, proving fetchObservationsPage is called exactly ONCE
  // and the honest terminal reason survives.

  function makeFetchObservationsPageOnce(obs: ObservationRow): {
    fetchObservationsPage: BatchProcessingDeps['fetchObservationsPage']
    callCount: () => number
  } {
    let calls = 0
    const fetchObservationsPage: BatchProcessingDeps['fetchObservationsPage'] = async () => {
      calls++
      // Second (or later) call returns an empty page -- exactly the
      // real production scenario that previously let 'queue_empty'
      // silently overwrite the real terminal reason. If the fix works,
      // this function must never be called a second time at all.
      if (calls > 1) return { rows: [], error: null, pool: 'old' }
      return { rows: [obs], error: null, pool: 'old' }
    }
    return { fetchObservationsPage, callCount: () => calls }
  }

  test('request_too_large: stopped_reason survives, fetchObservationsPage called exactly once, no second page/observation processed', async () => {
    const obs1 = makeObservation('obs-1')
    const { fetchObservationsPage, callCount } = makeFetchObservationsPageOnce(obs1)
    const { deps, calls } = makeDeps({
      fetchObservationsPage,
      processObservation: (async (obs: ObservationRow) => {
        calls.processObservation.push(obs.id)
        throw new AIRequestTooLargeError('too large', 'llama-3.1-8b-instant', 5140, 5100)
      }) as BatchProcessingDeps['processObservation'],
    })

    const stats = await runEnrichmentCycle(Date.now() + 30_000, deps)

    assert.equal(
      stats.stopped_reason,
      'request_too_large',
      'the real terminal reason must survive, never overwritten to queue_empty',
    )
    assert.notEqual(stats.stopped_reason, 'queue_empty')
    assert.equal(
      callCount(),
      1,
      'fetchObservationsPage must be called exactly once -- the outer loop must stop immediately, never fetch a second page',
    )
    assert.deepEqual(
      calls.processObservation,
      ['obs-1'],
      'only the one observation from the first page was ever attempted',
    )
  })

  test('source_read_failed: stopped_reason survives, fetchObservationsPage called exactly once, no second page/observation processed', async () => {
    const obs1 = makeObservation('obs-1')
    const { fetchObservationsPage, callCount } = makeFetchObservationsPageOnce(obs1)
    const { deps, calls } = makeDeps({
      fetchObservationsPage,
      fetchSourceInfo: async () => ({
        ok: false,
        trustScore: 0,
        sourceName: '',
        error: 'connection reset',
      }),
    })

    const stats = await runEnrichmentCycle(Date.now() + 30_000, deps)

    assert.equal(stats.stopped_reason, 'source_read_failed')
    assert.notEqual(stats.stopped_reason, 'queue_empty')
    assert.equal(callCount(), 1, 'fetchObservationsPage must be called exactly once')
    assert.deepEqual(
      calls.processObservation,
      [],
      'processObservation must never run when the source read itself fails',
    )
  })

  test('write_failed: stopped_reason survives, fetchObservationsPage called exactly once, no second page/observation processed', async () => {
    const obs1 = makeObservation('obs-1')
    const { fetchObservationsPage, callCount } = makeFetchObservationsPageOnce(obs1)
    const { deps, calls } = makeDeps({
      fetchObservationsPage,
      markObservationProcessed: (async () => ({
        ok: false,
        writeError: 'connection reset',
      })) as BatchProcessingDeps['markObservationProcessed'],
    })

    const stats = await runEnrichmentCycle(Date.now() + 30_000, deps)

    assert.equal(stats.stopped_reason, 'write_failed')
    assert.notEqual(stats.stopped_reason, 'queue_empty')
    assert.equal(callCount(), 1, 'fetchObservationsPage must be called exactly once')
    assert.deepEqual(
      calls.processObservation,
      ['obs-1'],
      'the one observation was genuinely processed -- only the RESULT write failed',
    )
  })

  test('time_budget: stopped_reason survives, fetchObservationsPage called exactly once, no second page/observation processed', async () => {
    const obs1 = makeObservation('obs-1')
    const obs2 = makeObservation('obs-2')
    let calls = 0
    const fetchObservationsPage: BatchProcessingDeps['fetchObservationsPage'] = async () => {
      calls++
      if (calls > 1) return { rows: [], error: null, pool: 'old' }
      return { rows: [obs1, obs2], error: null, pool: 'old' }
    }
    const processedIds: string[] = []
    const { deps } = makeDeps({
      fetchObservationsPage,
      processObservation: (async (obs: ObservationRow) => {
        processedIds.push(obs.id)
        return { observationId: obs.id, outcome: 'signal_created', signalId: 'sig-1' }
      }) as BatchProcessingDeps['processObservation'],
    })

    // A deadline just barely under processBatchOfObservations' own
    // 8-second per-item safety margin (msUntilDeadline(deadlineAt) <
    // 8_000) -- genuinely triggers a real time_budget stop on the
    // FIRST observation, exactly matching real production timing
    // logic, not a synthetic override of the stop condition itself.
    const deadlineAt = Date.now() + 5_000

    const stats = await runEnrichmentCycle(deadlineAt, deps)

    assert.equal(stats.stopped_reason, 'time_budget')
    assert.notEqual(stats.stopped_reason, 'queue_empty')
    assert.equal(calls, 1, 'fetchObservationsPage must be called exactly once')
    assert.deepEqual(
      processedIds,
      [],
      'neither observation should be processed -- the deadline check runs before the first item',
    )
  })
})

describe('merge-blocker regression: a genuine error-record write failure (markObservationProcessed) attempts a controlled requeue instead of leaving the observation with no retry_after -- driven through the REAL runEnrichmentCycle, not processBatchOfObservations in isolation', () => {
  test('successful requeue after error-record write failure: attempted=1, retried=1, failed=0, stopped_reason="write_failed", observation fetched once, processObservation called once, second observation never attempted', async () => {
    const obs1 = makeObservation('obs-1')
    const obs2 = makeObservation('obs-2')
    let fetchCalls = 0
    const fetchObservationsPage: BatchProcessingDeps['fetchObservationsPage'] = async () => {
      fetchCalls++
      if (fetchCalls > 1) return { rows: [], error: null, pool: 'old' }
      return { rows: [obs1, obs2], error: null, pool: 'old' }
    }
    let processObservationCalls = 0
    let requeueCalls = 0
    let markProcessedCalls = 0
    const deps: BatchProcessingDeps = {
      fetchSourceInfo: async () => ({ ok: true, trustScore: 0.8, sourceName: 'Test Source' }),
      fetchObservationsPage,
      processObservation: (async (obs) => {
        processObservationCalls++
        throw new Error(`generic processing failure for ${obs.id}`)
      }) as BatchProcessingDeps['processObservation'],
      markObservationProcessed: async () => {
        markProcessedCalls++
        // The error-record write itself genuinely fails.
        return { ok: false, writeError: 'connection reset' }
      },
      markObservationForRetry: async () => {
        requeueCalls++
        return 'ok' // requeue genuinely succeeds
      },
      sleep: async () => {},
    }

    const stats = await runEnrichmentCycle(Date.now() + 30_000, deps)

    assert.equal(
      fetchCalls,
      1,
      'the queue must be fetched exactly once -- the cycle must stop after this page, never fetch a second one',
    )
    assert.equal(
      processObservationCalls,
      1,
      'processObservation must be called exactly once (for obs-1) -- obs-2 must never be attempted',
    )
    assert.equal(markProcessedCalls, 1, 'the error-record write must be attempted exactly once')
    assert.equal(
      requeueCalls,
      1,
      'exactly one requeue attempt must be made after the error-record write failure',
    )
    assert.equal(stats.attempted, 1)
    assert.equal(
      stats.retried,
      1,
      'the successful requeue counts toward retried, not failed -- this observation is not yet resolved this cycle',
    )
    assert.equal(stats.failed, 0)
    assert.equal(stats.succeeded, 0)
    assert.equal(stats.rejected, 0)
    assert.equal(stats.stopped_reason, 'write_failed')
  })

  test('requeue ALSO fails after error-record write failure: attempted=1, failed=1, retried=0, stopped_reason="requeue_failed", error_breakdown.requeue_failed=1, observation fetched once, processObservation called once, second observation never attempted', async () => {
    const obs1 = makeObservation('obs-1')
    const obs2 = makeObservation('obs-2')
    let fetchCalls = 0
    const fetchObservationsPage: BatchProcessingDeps['fetchObservationsPage'] = async () => {
      fetchCalls++
      if (fetchCalls > 1) return { rows: [], error: null, pool: 'old' }
      return { rows: [obs1, obs2], error: null, pool: 'old' }
    }
    let processObservationCalls = 0
    let requeueCalls = 0
    const deps: BatchProcessingDeps = {
      fetchSourceInfo: async () => ({ ok: true, trustScore: 0.8, sourceName: 'Test Source' }),
      fetchObservationsPage,
      processObservation: (async (obs) => {
        processObservationCalls++
        throw new Error(`generic processing failure for ${obs.id}`)
      }) as BatchProcessingDeps['processObservation'],
      markObservationProcessed: async () => ({ ok: false, writeError: 'connection reset' }),
      markObservationForRetry: async () => {
        requeueCalls++
        throw new Error('requeue write also failed')
      },
      sleep: async () => {},
    }

    const stats = await runEnrichmentCycle(Date.now() + 30_000, deps)

    assert.equal(fetchCalls, 1, 'the queue must be fetched exactly once')
    assert.equal(
      processObservationCalls,
      1,
      'processObservation must be called exactly once -- obs-2 must never be attempted',
    )
    assert.equal(
      requeueCalls,
      1,
      'exactly one requeue attempt must be made, even though it also fails',
    )
    assert.equal(stats.attempted, 1)
    assert.equal(
      stats.failed,
      1,
      'a requeue that ALSO fails counts toward failed -- the observation is genuinely, permanently unresolved this cycle',
    )
    assert.equal(
      stats.retried,
      0,
      'retried must NOT be incremented when the requeue write itself failed',
    )
    assert.equal(stats.succeeded, 0)
    assert.equal(stats.rejected, 0)
    assert.equal(stats.stopped_reason, 'requeue_failed')
    assert.equal(stats.error_breakdown.requeue_failed, 1)
  })

  test('the successful (non-degraded) path is unaffected: a genuine processing error whose error-record write SUCCEEDS is still counted as failed, not retried', async () => {
    const obs1 = makeObservation('obs-1')
    const deps: BatchProcessingDeps = {
      fetchSourceInfo: async () => ({ ok: true, trustScore: 0.8, sourceName: 'Test Source' }),
      fetchObservationsPage: async () => ({ rows: [obs1], error: null, pool: 'old' }),
      processObservation: (async (obs) => {
        throw new Error(`generic processing failure for ${obs.id}`)
      }) as BatchProcessingDeps['processObservation'],
      markObservationProcessed: async () => ({ ok: true }), // the error-record write genuinely succeeds
      markObservationForRetry: async () => {
        throw new Error('markObservationForRetry must never be called on this path')
      },
      sleep: async () => {},
    }

    const stats = await processBatchOfObservations([obs1], Date.now() + 30_000, deps)

    assert.equal(stats.attempted, 1)
    assert.equal(
      stats.failed,
      1,
      'a successfully-recorded permanent error is still counted as failed, matching the existing, unaffected behavior',
    )
    assert.equal(stats.retried, 0)
  })
})
