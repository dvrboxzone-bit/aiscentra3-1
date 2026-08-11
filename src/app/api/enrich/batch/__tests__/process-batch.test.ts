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

import { processBatchOfObservations, type BatchProcessingDeps } from '../route'
import { AIDeadlineExceededError } from '@/lib/ai/deadline'
import { AITokenBudgetExceededError } from '@/lib/ai/budget-gate'
import { AIProviderError } from '@/lib/ai/client'
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
    fetchSourceInfo: async () => ({ trustScore: 0.8, sourceName: 'Test Source' }),
    processObservation: (async (obs: ObservationRow) => {
      calls.processObservation.push(obs.id)
      return { observationId: obs.id, outcome: 'signal_created', signalId: 'sig-1' }
    }) as BatchProcessingDeps['processObservation'],
    markObservationProcessed: (async (id: string) => {
      calls.markProcessed.push(id)
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
    assert.equal(stats.attempted, 0)
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
    assert.equal(stats.attempted, 0)
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
      0,
      'obs-1 must NOT count as processed -- it was refused, not completed',
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
