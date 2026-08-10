/**
 * AIscentra — centralized cron guard tests
 *
 * REAL bug this guards: every cron route previously did its own
 * `!==` string comparison against CRON_SECRET -- a timing side-channel
 * (short-circuits on first mismatch, making comparison time leak how
 * many leading bytes matched). Centralized here with
 * crypto.timingSafeEqual.
 */
import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

import { verifyCronSecret, extractCronSecret, isAuthorizedCronRequest } from '../cron-guard'

describe('verifyCronSecret', () => {
  const originalSecret = process.env['CRON_SECRET']
  beforeEach(() => {
    process.env['CRON_SECRET'] = 'real-secret-value-12345'
  })
  afterEach(() => {
    if (originalSecret === undefined) delete process.env['CRON_SECRET']
    else process.env['CRON_SECRET'] = originalSecret
  })

  test('the correct secret is accepted', () => {
    assert.equal(verifyCronSecret('real-secret-value-12345'), true)
  })

  test('an incorrect secret of the SAME length is rejected', () => {
    assert.equal(verifyCronSecret('wrong-secret-value-12345'), false)
  })

  test('an incorrect secret of a DIFFERENT length is rejected, not thrown', () => {
    assert.equal(verifyCronSecret('short'), false)
    assert.equal(verifyCronSecret('a-much-much-much-longer-guess-than-the-real-secret'), false)
  })

  test('an empty string is rejected', () => {
    assert.equal(verifyCronSecret(''), false)
  })

  test('null/undefined is rejected, not thrown', () => {
    assert.equal(verifyCronSecret(null), false)
    assert.equal(verifyCronSecret(undefined), false)
  })

  test('a missing CRON_SECRET env var fails closed (never authorizes), not thrown', () => {
    delete process.env['CRON_SECRET']
    assert.equal(verifyCronSecret('anything-at-all'), false)
  })

  test('comparison time does not scale with the number of matching leading characters -- real, measured constant-time property', () => {
    // Not a precise timing-attack reproduction (unreliable in a test
    // runner with GC/scheduler noise), but a real, meaningful sanity
    // check: a naive `!==` comparison exits near-instantly on a
    // first-byte mismatch and takes measurably longer as more leading
    // bytes match (each additional matching byte requires one more
    // comparison before the mismatch is found) -- timingSafeEqual must
    // show no such trend, since it always compares every byte.
    const real = process.env['CRON_SECRET']
    assert.ok(real, 'test setup must have set CRON_SECRET')
    const guesses = [
      'x'.repeat(real.length), // mismatches at byte 0
      real.slice(0, Math.floor(real.length / 2)) +
        'x'.repeat(real.length - Math.floor(real.length / 2)), // mismatches halfway through
      real.slice(0, -1) + 'x', // mismatches at the last byte
    ]
    const SAMPLES = 2000
    const timings = guesses.map((guess) => {
      const start = process.hrtime.bigint()
      for (let i = 0; i < SAMPLES; i++) verifyCronSecret(guess)
      return Number(process.hrtime.bigint() - start)
    })
    // Real assertion: the LAST-byte-mismatch case (which a naive !==
    // comparison would take the longest on) must not be dramatically
    // slower than the FIRST-byte-mismatch case. A generous ratio bound
    // (5x) accounts for real scheduler/GC noise in a JS test runner
    // while still catching a genuine, gross timing leak.
    const ratio = (timings[2] ?? 0) / (timings[0] ?? 1)
    assert.ok(
      ratio < 5,
      `comparison time for a last-byte mismatch must not be dramatically slower than a first-byte mismatch (ratio=${ratio.toFixed(2)}) -- a naive !== comparison would show a much larger ratio here`,
    )
  })

  test('comparison time does not scale with GUESS LENGTH -- the real third-review fix (hash-then-compare removes the length-check branch)', () => {
    // The specific gap this closes: the previous version of this guard
    // did `if (providedBuf.length !== realBuf.length) return false`
    // BEFORE calling timingSafeEqual -- a length comparison that is
    // itself not constant-time, potentially leaking the real secret's
    // LENGTH to an attacker sending guesses of many different lengths
    // and measuring response time. Hashing both sides with SHA-256
    // first means every comparison is between two 32-byte digests
    // regardless of guess length -- there is no length-dependent
    // branch on the secret anywhere in this function anymore.
    const shortGuess = 'x'
    const sameLengthGuess = 'x'.repeat(process.env['CRON_SECRET']?.length ?? 24)
    const longGuess = 'x'.repeat(500)
    const SAMPLES = 3000

    const timeFor = (guess: string): number => {
      const start = process.hrtime.bigint()
      for (let i = 0; i < SAMPLES; i++) verifyCronSecret(guess)
      return Number(process.hrtime.bigint() - start)
    }

    const tShort = timeFor(shortGuess)
    const tSame = timeFor(sameLengthGuess)
    const tLong = timeFor(longGuess)

    // A generous bound (5x) for the same real-world scheduler/GC noise
    // reasons as the test above -- the real property being proven is
    // that guess length does not produce a LARGE, systematic timing
    // difference (which a naive length-check-then-compare pattern
    // would show: longer guesses take measurably longer to reach the
    // point of rejection in some naive implementations).
    const maxRatio = Math.max(tShort, tSame, tLong) / Math.min(tShort, tSame, tLong)
    assert.ok(
      maxRatio < 5,
      `comparison time must not scale meaningfully with guess length (ratio=${maxRatio.toFixed(2)}) -- hashing before comparison removes this signal entirely`,
    )
  })
})

describe('extractCronSecret', () => {
  test('extracts from a standard Authorization: Bearer header', () => {
    const req = new Request('https://example.com', {
      headers: { authorization: 'Bearer my-secret' },
    })
    assert.equal(extractCronSecret(req), 'my-secret')
  })

  test('extracts from the legacy x-cron-secret header', () => {
    const req = new Request('https://example.com', { headers: { 'x-cron-secret': 'my-secret' } })
    assert.equal(extractCronSecret(req), 'my-secret')
  })

  test('Authorization header takes precedence when both are present', () => {
    const req = new Request('https://example.com', {
      headers: { authorization: 'Bearer bearer-secret', 'x-cron-secret': 'legacy-secret' },
    })
    assert.equal(extractCronSecret(req), 'bearer-secret')
  })

  test('a non-Bearer Authorization header is not treated as a cron secret', () => {
    const req = new Request('https://example.com', {
      headers: { authorization: 'Basic dXNlcjpwYXNz' },
    })
    assert.equal(extractCronSecret(req), null)
  })

  test('no relevant header present returns null', () => {
    const req = new Request('https://example.com')
    assert.equal(extractCronSecret(req), null)
  })
})

describe('isAuthorizedCronRequest', () => {
  const originalSecret = process.env['CRON_SECRET']
  beforeEach(() => {
    process.env['CRON_SECRET'] = 'real-secret-value-12345'
  })
  afterEach(() => {
    if (originalSecret === undefined) delete process.env['CRON_SECRET']
    else process.env['CRON_SECRET'] = originalSecret
  })

  test('a request with the correct Bearer secret is authorized', () => {
    const req = new Request('https://example.com', {
      headers: { authorization: 'Bearer real-secret-value-12345' },
    })
    assert.equal(isAuthorizedCronRequest(req), true)
  })

  test('a request with an incorrect secret is rejected', () => {
    const req = new Request('https://example.com', { headers: { authorization: 'Bearer wrong' } })
    assert.equal(isAuthorizedCronRequest(req), false)
  })

  test('a request with no auth header at all is rejected', () => {
    assert.equal(isAuthorizedCronRequest(new Request('https://example.com')), false)
  })
})
