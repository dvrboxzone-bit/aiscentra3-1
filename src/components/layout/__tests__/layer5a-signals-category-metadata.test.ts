import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

/**
 * AIscentra — regression test for the real SEO gap found and fixed
 * (explicit owner instruction, researched via web search, approved in
 * Notion before implementation): all 9 real Signal category filter
 * pages (/signals?category=RESEARCH, ?category=MODELS, etc.)
 * previously shared one identical, generic title/description --
 * confirmed via direct code read before this fix. Each real category
 * now gets its own distinct copy.
 */
describe('/signals?category=X — each real category has its own distinct, non-generic metadata', () => {
  test('all 9 real categories produce a distinct title and description, none identical to each other or to the generic default', async () => {
    const { generateMetadata } = await import('../../../app/signals/page')
    const categories = [
      'RESEARCH',
      'MODELS',
      'COMPANIES',
      'INFRASTRUCTURE',
      'OPEN_SOURCE',
      'FUNDING',
      'REGULATION',
      'AGENTS',
      'HARDWARE',
    ]

    const results = await Promise.all(
      categories.map((category) =>
        generateMetadata({ searchParams: Promise.resolve({ category }) }),
      ),
    )

    const titles = results.map((r) => r.title)
    const descriptions = results.map((r) => r.description)

    assert.equal(
      new Set(titles).size,
      9,
      'all 9 real category titles must be distinct -- no two categories may share the same title',
    )
    assert.equal(
      new Set(descriptions).size,
      9,
      'all 9 real category descriptions must be distinct -- the real gap this fix closes',
    )

    for (const title of titles) {
      assert.notEqual(
        title,
        'Signals',
        'a real category page must not fall back to the bare generic title',
      )
    }
  })

  test('an unknown/invalid category value falls back to the generic default, not a crash or undefined', async () => {
    const { generateMetadata } = await import('../../../app/signals/page')
    const metadata = await generateMetadata({
      searchParams: Promise.resolve({ category: 'NOT_A_REAL_CATEGORY' }),
    })
    assert.equal(metadata.title, 'Signals')
  })
})
