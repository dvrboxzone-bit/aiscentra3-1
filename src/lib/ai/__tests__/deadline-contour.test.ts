/**
 * AIscentra — AI Deadline Contour Tests
 *
 * Covers the real incident this contour fixes: a single stalled or
 * heavily-retried AI call consuming the entire outer time budget with
 * no way to abort, confirmed live via Vercel's own runtime error log
 * ("Task timed out after 60 seconds" on /api/enrich/batch).
 *
 * Scenarios required by the task: retry, Retry-After, TPM wait, a
 * hung fetch, model fallback, and correct requeue classification.
 */
import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

import {
  AIDeadlineExceededError,
  ensureTimeLeft,
  msUntilDeadline,
  sleepWithDeadline,
} from '../deadline'

// ── deadline.ts — direct unit tests ────────────────────────────────────────────

describe('deadline.ts', () => {
  test('ensureTimeLeft does not throw when enough time remains', () => {
    const deadlineAt = Date.now() + 10_000
    assert.doesNotThrow(() => ensureTimeLeft(deadlineAt, 1_000, 'test'))
  })

  test('ensureTimeLeft throws AIDeadlineExceededError when too little time remains', () => {
    const deadlineAt = Date.now() + 500
    assert.throws(
      () => ensureTimeLeft(deadlineAt, 5_000, 'test-context'),
      (err: unknown) => {
        assert.ok(err instanceof AIDeadlineExceededError)
        assert.equal(err.name, 'AI_DEADLINE_EXCEEDED')
        assert.equal(err.context, 'test-context')
        return true
      },
    )
  })

  test('msUntilDeadline floors at 0 for a deadline already in the past', () => {
    assert.equal(msUntilDeadline(Date.now() - 10_000), 0)
  })

  test('msUntilDeadline returns a positive value for a future deadline', () => {
    const remaining = msUntilDeadline(Date.now() + 5_000)
    assert.ok(remaining > 0 && remaining <= 5_000)
  })

  test('sleepWithDeadline throws immediately (no real wait) if the delay would cross the deadline', async () => {
    const deadlineAt = Date.now() + 100
    const start = Date.now()
    await assert.rejects(
      sleepWithDeadline(10_000, deadlineAt, 'would-exceed'),
      (err: unknown) => err instanceof AIDeadlineExceededError,
    )
    // Must fail fast -- proof it never actually slept for anywhere near
    // the requested 10s.
    assert.ok(Date.now() - start < 500)
  })

  test('sleepWithDeadline actually waits when the delay fits comfortably', async () => {
    const deadlineAt = Date.now() + 10_000
    const start = Date.now()
    await sleepWithDeadline(50, deadlineAt, 'fits')
    assert.ok(Date.now() - start >= 45)
  })
})

// ── tpm-manager.ts — TPM wait respects the deadline ────────────────────────────

describe('tpm-manager.ts deadline awareness', () => {
  test('waitForTPMBudget throws AIDeadlineExceededError instead of oversleeping past the deadline', async () => {
    const { checkTPMBudget, waitForTPMBudget, recordActualTokens } = await import('../tpm-manager')
    const model = `test-model-${Date.now()}-${Math.random()}`

    // Saturate this model's rolling window so the next check reports
    // "not allowed" and computes a real wait time.
    recordActualTokens(model, 10_000, 0)
    const check = checkTPMBudget(model, 1_000)
    assert.equal(check.allowed, false, 'test setup: budget should be saturated')
    assert.ok(check.waitMs > 1_000, 'test setup: computed wait should be substantial')

    // Deadline far shorter than the real TPM wait the manager just
    // computed -- must fail fast, not sleep for the full window reset.
    const deadlineAt = Date.now() + 200
    const start = Date.now()
    await assert.rejects(
      waitForTPMBudget(model, 1_000, deadlineAt),
      (err: unknown) => err instanceof AIDeadlineExceededError,
    )
    assert.ok(Date.now() - start < 2_000, 'must fail fast, not sleep for the full TPM window')
  })

  test('waitForTPMBudget returns normally once budget frees up before the deadline', async () => {
    const { waitForTPMBudget } = await import('../tpm-manager')
    const model = `test-model-fresh-${Date.now()}-${Math.random()}`
    // Fresh model, never recorded -- budget check should pass immediately.
    const deadlineAt = Date.now() + 10_000
    await waitForTPMBudget(model, 100, deadlineAt)
    // No throw = pass.
  })
})

// ── agent.ts — integration tests via a mocked global.fetch ─────────────────────
//
// classifier role's chain is exactly [MINI, PRIMARY] (both provider
// 'groq'), confirmed in models.ts -- used below to test fallback
// without needing real credentials or network access.

describe('agent.ts deadline contour (mocked fetch)', () => {
  const originalFetch = globalThis.fetch
  const originalGroqKey = process.env['GROQ_API_KEY']

  beforeEach(() => {
    process.env['GROQ_API_KEY'] = 'test-key-not-real'
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    if (originalGroqKey === undefined) delete process.env['GROQ_API_KEY']
    else process.env['GROQ_API_KEY'] = originalGroqKey
  })

  function jsonResponse(body: unknown, init?: ResponseInit): Response {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
      ...init,
    })
  }

  const VALID_COMPLETION = {
    choices: [{ message: { content: '{"ok":true}' } }],
    usage: { total_tokens: 42 },
  }

  test('a deadline already exceeded before the first attempt throws immediately with zero fetch calls', async () => {
    const { agentCompleteJSON } = await import('../agent')
    let fetchCalls = 0
    globalThis.fetch = (async () => {
      fetchCalls++
      return jsonResponse(VALID_COMPLETION)
    }) as typeof fetch

    const deadlineAt = Date.now() - 1_000 // already in the past
    const { z } = await import('zod')
    await assert.rejects(
      agentCompleteJSON(
        'classifier',
        [{ role: 'user', content: 'hi' }],
        z.object({ ok: z.boolean() }),
        {},
        deadlineAt,
      ),
      (err: unknown) => err instanceof AIDeadlineExceededError,
    )
    assert.equal(
      fetchCalls,
      0,
      'must not attempt any network call once the deadline has already passed',
    )
  })

  test('retry: a retryable 503 is retried and eventually succeeds within the deadline', async () => {
    const { agentComplete } = await import('../agent')
    let attempt = 0
    globalThis.fetch = (async () => {
      attempt++
      if (attempt === 1) {
        return new Response('server error', { status: 503 })
      }
      return jsonResponse(VALID_COMPLETION)
    }) as typeof fetch

    const deadlineAt = Date.now() + 30_000 // generous -- real 5s backoff must fit
    const result = await agentComplete(
      'classifier',
      [{ role: 'user', content: 'hi' }],
      {},
      deadlineAt,
    )
    assert.equal(attempt, 2, 'should have retried exactly once before succeeding')
    assert.equal(result.content, '{"ok":true}')
  })

  test('Retry-After header is honored as the backoff duration', async () => {
    const { agentComplete } = await import('../agent')
    let attempt = 0
    const timestamps: number[] = []
    globalThis.fetch = (async () => {
      attempt++
      timestamps.push(Date.now())
      if (attempt === 1) {
        return new Response('rate limited', {
          status: 429,
          headers: { 'retry-after': '0.3' }, // 300ms — short so the test stays fast
        })
      }
      return jsonResponse(VALID_COMPLETION)
    }) as typeof fetch

    const deadlineAt = Date.now() + 30_000
    await agentComplete('classifier', [{ role: 'user', content: 'hi' }], {}, deadlineAt)
    assert.equal(attempt, 2)
    const actualGap = (timestamps[1] ?? 0) - (timestamps[0] ?? 0)
    // Retry-After said 300ms (+500ms safety margin added by backoffMs) --
    // confirm the gap is in that ballpark, not the unrelated 5s base backoff.
    assert.ok(actualGap >= 250 && actualGap < 4_000, `expected ~300-800ms gap, got ${actualGap}ms`)
  })

  test('a hung fetch is genuinely aborted at the deadline, not merely stopped-awaiting', async () => {
    const { agentComplete } = await import('../agent')
    let sawAbort = false
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      return await new Promise<Response>((resolve, reject) => {
        // AbortSignal.timeout()'s own internal timer is unref'd by
        // design -- it does not keep Node's event loop alive on its
        // own. A REAL hung fetch keeps the loop alive via its own
        // pending socket I/O; this mock has no real I/O at all, so it
        // needs an explicit, referenced keep-alive timer for the
        // duration of this simulated hang, or the process can decide
        // the event loop is idle and exit/cancel before the abort ever
        // fires (confirmed directly: a bare `AbortSignal.timeout(500)`
        // with nothing else scheduled never fires its listener at all
        // in this runtime). This mirrors real socket behavior, not a
        // workaround for a code bug -- production's real fetch() does
        // not have this problem because it always has live I/O.
        const keepAlive = setInterval(() => {}, 50)
        const signal = init?.signal
        if (signal) {
          signal.addEventListener('abort', () => {
            sawAbort = true
            clearInterval(keepAlive)
            reject(new DOMException('This operation was aborted', 'TimeoutError'))
          })
        }
        // Safety net so the test itself cannot hang forever if the
        // abort somehow never fires -- but this outer bound (8s) is far
        // longer than the 2.5s deadline under test, so it should never
        // actually trigger if the real behavior under test is correct.
        setTimeout(() => {
          clearInterval(keepAlive)
          reject(new Error('test safety-net timeout -- AbortSignal never fired'))
        }, 8_000).unref?.()
        void resolve // never called on the success path -- hang is the point
      })
    }) as typeof fetch

    // Long enough to clear the pre-fetch deadline checks (>=2000ms
    // before the TPM wait, >=1000ms before the fetch itself) so this
    // test genuinely reaches and exercises fetch()'s AbortSignal,
    // rather than being caught by an earlier, cheaper pre-check.
    const deadlineAt = Date.now() + 2_500
    const start = Date.now()
    await assert.rejects(
      agentComplete('classifier', [{ role: 'user', content: 'hi' }], {}, deadlineAt),
      (err: unknown) => err instanceof AIDeadlineExceededError,
    )
    assert.ok(
      sawAbort,
      'the AbortSignal must actually have fired and been observed by the mocked fetch',
    )
    assert.ok(Date.now() - start < 5_000, 'must not hang well past the deadline')
  })

  test('fallback: primary model fails non-retryably, fallback model succeeds', async () => {
    const { agentComplete } = await import('../agent')
    const modelsSeen: string[] = []
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse((init?.body as string) ?? '{}') as { model: string }
      modelsSeen.push(body.model)
      // First model in the chain (MINI) fails with a non-retryable 400.
      // Second model (PRIMARY, the fallback) succeeds.
      if (modelsSeen.length === 1) {
        return new Response('bad request', { status: 400 })
      }
      return jsonResponse(VALID_COMPLETION)
    }) as typeof fetch

    const deadlineAt = Date.now() + 30_000
    const result = await agentComplete(
      'classifier',
      [{ role: 'user', content: 'hi' }],
      {},
      deadlineAt,
    )
    assert.equal(
      modelsSeen.length,
      2,
      'should have tried exactly 2 distinct models (no retry within either, since 400 is non-retryable)',
    )
    assert.notEqual(
      modelsSeen[0],
      modelsSeen[1],
      'the two attempts must be different models (primary then fallback)',
    )
    assert.equal(result.content, '{"ok":true}')
  })

  test('deadline exceeded mid-chain propagates immediately instead of being treated as "try next model"', async () => {
    const { agentComplete } = await import('../agent')
    let calls = 0
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      calls++
      return await new Promise<Response>((resolve, reject) => {
        // Same real-I/O-vs-mock keep-alive point as the previous test:
        // AbortSignal.timeout()'s own timer is unref'd and does not by
        // itself keep the event loop alive; a real hung fetch would via
        // its own live socket. See that test's comment for the direct
        // confirmation this isn't a workaround for a code bug.
        const keepAlive = setInterval(() => {}, 50)
        init?.signal?.addEventListener('abort', () => {
          clearInterval(keepAlive)
          reject(new DOMException('aborted', 'TimeoutError'))
        })
        setTimeout(() => {
          clearInterval(keepAlive)
          reject(new Error('test safety-net timeout -- AbortSignal never fired'))
        }, 8_000).unref?.()
        void resolve
      })
    }) as typeof fetch

    // Long enough to clear the pre-fetch deadline checks (>=2000ms
    // before the TPM wait, >=1000ms before the fetch itself) so the
    // first model's fetch genuinely starts -- then the deadline expires
    // WHILE that first call is hung, via the real AbortSignal, not via
    // an earlier pre-check. This is what actually proves the fallback
    // model is never attempted after a deadline failure: if the
    // deadline were instead caught by a pre-check before any fetch,
    // this test would trivially pass with calls=0 without ever
    // exercising the "already mid-chain when it expires" scenario the
    // task asked for.
    const deadlineAt = Date.now() + 2_500
    await assert.rejects(
      agentComplete('classifier', [{ role: 'user', content: 'hi' }], {}, deadlineAt),
      (err: unknown) => err instanceof AIDeadlineExceededError,
    )
    // Exactly one model should have been attempted -- the deadline fired
    // during that first (hung) call, and the chain loop must not have
    // gone on to try the fallback model afterward (there is no time
    // left, and doing so would silently convert a deadline failure into
    // a generic chain-exhaustion error).
    assert.equal(calls, 1)
  })

  test('body-read hangs after headers arrive: the deadline still fires, converts to AIDeadlineExceededError, and no fallback model is attempted', async () => {
    const { agentComplete } = await import('../agent')
    let fetchCalls = 0
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      fetchCalls++
      // Headers/status resolve immediately (this IS what "headers
      // received" means) -- but reading the body hangs, exactly like a
      // server that sends a 200 status then stalls mid-stream. Only
      // this fetch call's own AbortSignal can end the hang, proving
      // client.ts's body-read guard (not just its fetch()-call guard)
      // is what catches this.
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () =>
          new Promise((_resolve, reject) => {
            const keepAlive = setInterval(() => {}, 50)
            init?.signal?.addEventListener('abort', () => {
              clearInterval(keepAlive)
              reject(new DOMException('aborted', 'TimeoutError'))
            })
            setTimeout(() => {
              clearInterval(keepAlive)
              reject(new Error('test safety-net -- AbortSignal never fired for body read'))
            }, 8_000).unref?.()
          }),
        text: () => Promise.resolve(''),
      } as unknown as Response
    }) as typeof fetch

    const deadlineAt = Date.now() + 2_500
    await assert.rejects(
      agentComplete('classifier', [{ role: 'user', content: 'hi' }], {}, deadlineAt),
      (err: unknown) => err instanceof AIDeadlineExceededError,
    )
    // Exactly one model attempted -- the deadline fired while reading
    // that first model's response body, and the chain loop must not
    // have gone on to try the fallback model afterward.
    assert.equal(
      fetchCalls,
      1,
      'no fallback model should have been attempted after a deadline hit during body read',
    )
  })
})

// ── tpm-manager.ts — withModelQueue deadline & concurrency ─────────────────────

describe('withModelQueue deadline and concurrency', () => {
  test('a deadline exceeded while waiting for a busy queue throws without blocking the actual holder', async () => {
    const { withModelQueue } = await import('../tpm-manager')
    const model = `queue-test-a-${Date.now()}-${Math.random()}`
    let running = 0
    let maxConcurrent = 0
    const track = async <T>(fn: () => Promise<T>): Promise<T> => {
      running++
      maxConcurrent = Math.max(maxConcurrent, running)
      try {
        return await fn()
      } finally {
        running--
      }
    }

    // A holds the queue for 1200ms.
    const aPromise = withModelQueue(
      model,
      () => track(() => new Promise((r) => setTimeout(() => r('A'), 1200))),
      Date.now() + 10_000,
    )
    await new Promise((r) => setTimeout(r, 50)) // let A actually start

    // B has a short deadline and must give up waiting for A, not wait
    // for A's full 1200ms.
    const bStart = Date.now()
    await assert.rejects(
      withModelQueue(model, () => track(() => Promise.resolve('B')), Date.now() + 300),
      (err: unknown) => err instanceof AIDeadlineExceededError,
    )
    const bElapsed = Date.now() - bStart
    assert.ok(
      bElapsed < 1_000,
      `B should give up around its own ~300ms deadline, took ${bElapsed}ms`,
    )

    // A must complete normally, unaffected by B's early exit.
    const aResult = await aPromise
    assert.equal(aResult, 'A')
    assert.equal(
      maxConcurrent,
      1,
      'A and B must never have run concurrently (B never even called fn())',
    )
  })

  test('a call queued after a timed-out waiter still executes once the real holder finishes', async () => {
    const { withModelQueue } = await import('../tpm-manager')
    const model = `queue-test-b-${Date.now()}-${Math.random()}`

    const aStart = Date.now()
    const aPromise = withModelQueue(
      model,
      () => new Promise((r) => setTimeout(() => r('A'), 800)),
      Date.now() + 10_000,
    )
    await new Promise((r) => setTimeout(r, 50))

    // B times out waiting for A.
    await assert.rejects(
      withModelQueue(model, () => Promise.resolve('B'), Date.now() + 200),
      (err: unknown) => err instanceof AIDeadlineExceededError,
    )

    // C, queued logically after B, must still run -- and only once A
    // actually finishes, not immediately after B's own timeout.
    const cResult = await withModelQueue(model, () => Promise.resolve('C'), Date.now() + 10_000)
    const totalElapsed = Date.now() - aStart
    assert.equal(cResult, 'C')
    assert.ok(
      totalElapsed >= 750,
      `C must not have run before A's real completion (~800ms after A started); total elapsed was ${totalElapsed}ms`,
    )

    await aPromise
  })

  test('max concurrency for a given model never exceeds 1, even across a timed-out waiter', async () => {
    const { withModelQueue } = await import('../tpm-manager')
    const model = `queue-test-c-${Date.now()}-${Math.random()}`
    let running = 0
    let maxConcurrent = 0
    const track = async <T>(fn: () => Promise<T>): Promise<T> => {
      running++
      maxConcurrent = Math.max(maxConcurrent, running)
      try {
        return await fn()
      } finally {
        running--
      }
    }

    const aPromise = withModelQueue(
      model,
      () => track(() => new Promise((r) => setTimeout(() => r('A'), 600))),
      Date.now() + 10_000,
    )
    await new Promise((r) => setTimeout(r, 20))

    const bPromise = withModelQueue(
      model,
      () => track(() => Promise.resolve('B')),
      Date.now() + 150,
    ).catch((e: unknown) => e)
    const cPromise = withModelQueue(
      model,
      () => track(() => Promise.resolve('C')),
      Date.now() + 10_000,
    )

    const [aRes, bRes, cRes] = await Promise.all([aPromise, bPromise, cPromise])
    assert.equal(aRes, 'A')
    assert.ok(bRes instanceof AIDeadlineExceededError)
    assert.equal(cRes, 'C')
    assert.equal(maxConcurrent, 1, 'no two fn() calls for the same model may ever run concurrently')
  })

  test('regression: a caller that becomes ready but has <1000ms left still releases the queue for the next caller', async () => {
    // This is the exact scenario that exposed the "never releases on
    // the ready path" bug: A finishes BEFORE B's own deadline, so B's
    // wait resolves as 'ready' (not 'timeout') -- but by the time B
    // checks its OWN remaining time via ensureTimeLeft(...
    // post-queue-wait, which requires >=1000ms), B has less than that
    // left. B must throw AIDeadlineExceededError from that check, but
    // -- critically -- B must still release the queue (fn() was never
    // called, so nothing else will call markDone() for B), or every
    // later caller queued behind B would hang forever, exactly like the
    // original "timeout path never releases" bug, just reached via a
    // different path.
    const { withModelQueue } = await import('../tpm-manager')
    const model = `queue-test-regression-${Date.now()}-${Math.random()}`

    const aHoldMs = 300
    const aStart = Date.now()
    const aPromise = withModelQueue(
      model,
      () => new Promise((r) => setTimeout(() => r('A'), aHoldMs)),
      Date.now() + 10_000,
    )
    await new Promise((r) => setTimeout(r, 20)) // let A actually start

    // B's own deadline is set so that by the time A releases (~300ms
    // from A's own start), B has well under 1000ms of its own budget
    // left -- exercising the post-queue-wait check specifically, not
    // the queue-wait timeout branch tested above.
    const bDeadline = Date.now() + aHoldMs + 200 // ~200ms left once A releases
    await assert.rejects(
      withModelQueue(model, () => Promise.resolve('B'), bDeadline),
      (err: unknown) => {
        assert.ok(err instanceof AIDeadlineExceededError)
        assert.match(err.context, /post-queue-wait/)
        return true
      },
    )

    // C, queued after B, must run normally -- not hang -- proving B's
    // exit on the 'ready'-but-insufficient-time path still released the
    // queue correctly.
    const cResult = await Promise.race([
      withModelQueue(model, () => Promise.resolve('C'), Date.now() + 10_000),
      new Promise((_resolve, reject) =>
        setTimeout(() => reject(new Error('C hung -- queue was not released after B')), 3_000),
      ),
    ])
    assert.equal(cResult, 'C')

    const aResult = await aPromise
    assert.equal(aResult, 'A')
    void aStart
  })

  test('an already-expired caller on a free queue throws immediately, and a normal call after it still succeeds', async () => {
    const { withModelQueue } = await import('../tpm-manager')
    const model = `queue-test-expired-${Date.now()}-${Math.random()}`

    // Queue is completely free (no prior holder) -- the deadline is
    // already in the past before this call even starts.
    const start = Date.now()
    await assert.rejects(
      withModelQueue(model, () => Promise.resolve('should-not-run'), Date.now() - 1_000),
      (err: unknown) => err instanceof AIDeadlineExceededError,
    )
    assert.ok(
      Date.now() - start < 500,
      'an already-expired deadline on a free queue must fail fast',
    )

    // A normal, generously-deadlined call right after must succeed --
    // not be blocked by the immediately-expired one before it.
    const result = await withModelQueue(model, () => Promise.resolve('normal'), Date.now() + 10_000)
    assert.equal(result, 'normal')
  })

  test('regression: a timed-out waiter cleans up its map entry once the real holder finishes, if it was the last one registered', async () => {
    // This is the exact scenario the earlier version of the timeout
    // branch got wrong: it called markDone() once the real predecessor
    // (A) finished, but never re-ran the "am I still the last
    // registered entry -> delete it" check that the 'ready' path's
    // finally block already did -- leaving this model's key in
    // `modelQueues` forever whenever the timed-out caller (B) was the
    // last one registered when A eventually completed.
    const { withModelQueue, __hasModelQueueEntryForTests } = await import('../tpm-manager')
    const model = `queue-test-cleanup-${Date.now()}-${Math.random()}`

    const aHoldMs = 300
    const aPromise = withModelQueue(
      model,
      () => new Promise((r) => setTimeout(() => r('A'), aHoldMs)),
      Date.now() + 10_000,
    )
    await new Promise((r) => setTimeout(r, 20)) // let A actually start

    // B times out waiting for A -- and, critically, nobody queues up
    // after B, so B is the last registered entry when A eventually
    // finishes.
    await assert.rejects(
      withModelQueue(model, () => Promise.resolve('B'), Date.now() + 150),
      (err: unknown) => err instanceof AIDeadlineExceededError,
    )

    // Immediately after B's own throw, A is still running -- the entry
    // must still exist (release() for B's timeout path is deferred
    // until A's real completion, not run now).
    assert.equal(
      __hasModelQueueEntryForTests(model),
      true,
      'the queue entry must still exist while the real holder (A) is still in flight',
    )

    // Once A actually finishes, B's deferred release() must fire and
    // clean up the now-stale entry -- poll briefly rather than a single
    // fixed sleep, since the exact microtask timing of the deferred
    // `.then(release, release)` firing after A's own promise settles
    // is not guaranteed to complete on the very same tick.
    await aPromise
    const deadline = Date.now() + 2_000
    let cleaned = false
    while (Date.now() < deadline) {
      if (!__hasModelQueueEntryForTests(model)) {
        cleaned = true
        break
      }
      await new Promise((r) => setTimeout(r, 10))
    }
    assert.ok(
      cleaned,
      'the model queue entry must be removed once the real holder finishes and B was the last one registered',
    )
  })
})
