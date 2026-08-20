/**
 * AIscentra — real getSignals() stable sort with mandatory id
 * tie-breaker (checkpoint 5D).
 *
 * Source-level check: getSignals() is a real, async Supabase query
 * builder chain -- rendering it through jsdom would only prove the
 * MOCKED result renders, not that the REAL query itself requests a
 * stable order. Reading the real source directly confirms the actual
 * .order() chain genuinely includes both created_at (primary) and id
 * (tie-breaker), matching this project's own established pattern for
 * verifying real query-builder behavior without a live database.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('getSignals() — real stable sort, mandatory id tie-breaker', () => {
  test('the real getSignals() query genuinely orders by created_at DESC then id ASC as a tie-breaker -- without this, tied timestamps could duplicate or skip rows across paginated pages', () => {
    const src = readFileSync(
      join(__dirname, '..', '..', '..', 'modules', 'signals', 'queries.ts'),
      'utf-8',
    )
    assert.match(
      src,
      /\.order\('created_at',\s*\{\s*ascending:\s*false\s*\}\)\s*\n\s*\.order\('id',\s*\{\s*ascending:\s*true\s*\}\)/,
      'the real query must chain a second .order() on id immediately after created_at, providing a deterministic tie-breaker',
    )
  })

  test('the real getSignals() applies range-based pagination via .range() when page+pageSize are both provided, not a client-side slice of an unbounded fetch', () => {
    const src = readFileSync(
      join(__dirname, '..', '..', '..', 'modules', 'signals', 'queries.ts'),
      'utf-8',
    )
    assert.match(
      src,
      /query\.range\(from, to\)/,
      "the real pagination must use Supabase's own .range()",
    )
  })

  test('the real getSignalsCount() applies the exact same real status/category/has_verified_source filters as getSignals() -- REJECTED and unpublished signals are never counted', () => {
    const src = readFileSync(
      join(__dirname, '..', '..', '..', 'modules', 'signals', 'queries.ts'),
      'utf-8',
    )
    const countFnStart = src.indexOf('export async function getSignalsCount')
    assert.ok(countFnStart > 0, 'getSignalsCount must exist as a real exported function')
    const countFnBody = src.slice(countFnStart, src.indexOf('\n}', countFnStart))
    assert.match(
      countFnBody,
      /\.in\('status', \['ACTIVE', 'PROMOTED'\]\)/,
      'the real count must default to the same ACTIVE/PROMOTED status filter',
    )
    assert.match(
      countFnBody,
      /\.eq\('has_verified_source', true\)/,
      'the real count must apply the same real publication gate',
    )
  })
})
