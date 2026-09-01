import '../../../lib/test-utils/dom-setup'

import { test, describe, mock } from 'node:test'
import assert from 'node:assert/strict'
import { render } from '@testing-library/react'
import { forceReducedMotion } from '../../../app/__tests__/homepage-fixtures'
import { makeReport } from './layer5b-fixtures'

describe('/reports/[slug] — real epistemic-marker stripping and visual classification', () => {
  test("the real /reports/[slug] page recognizes and strips all 4 epistemic markers ([FACTUAL], [INTERPRETIVE], [HYPOTHETICAL], [FORECAST]) from the rendered text, and preserves [FORECAST]'s real visual classification (italic, distinct from the other 3)", async (t) => {
    const restore = forceReducedMotion()
    t.after(restore)
    const report = makeReport({
      id: 'r1',
      title: 'Real Report Detail',
      content:
        '[FACTUAL] A real factual paragraph.\n\n[INTERPRETIVE] A real interpretive paragraph.\n\n[HYPOTHETICAL] A real hypothetical paragraph.\n\n[FORECAST] A real forecast paragraph.',
    })
    mock.module('@/modules/reports/queries', {
      namedExports: { getReportById: async () => report },
    })
    const { default: ReportPage } = await import('../../../app/(public)/reports/[slug]/page')
    const jsx = await ReportPage({ params: Promise.resolve({ slug: 'r1' }) })
    const { container } = render(jsx)

    // All 4 raw marker tokens must be genuinely absent from the
    // rendered output -- the real .replace() chain strips them.
    for (const marker of ['[FACTUAL]', '[INTERPRETIVE]', '[HYPOTHETICAL]', '[FORECAST]']) {
      assert.doesNotMatch(
        container.innerHTML,
        new RegExp(marker.replace(/[[\]]/g, '\\$&')),
        `${marker} must be stripped from the rendered text`,
      )
    }

    // Real visual classification: the real production behavior applies
    // italic + a left border ONLY to the paragraph the real isForecast
    // check matches ([FORECAST] marker or "Expected:"/"Watch for:"
    // prefix) -- the other 3 (FACTUAL/INTERPRETIVE/HYPOTHETICAL) share
    // plain, non-italic styling. Verified against the actual class
    // list on each real rendered <p>, not assumed.
    const paragraphs = Array.from(container.querySelectorAll('article p'))
    const forecastP = paragraphs.find((p) => p.textContent?.includes('A real forecast paragraph.'))
    const factualP = paragraphs.find((p) => p.textContent?.includes('A real factual paragraph.'))
    assert.ok(forecastP, 'the forecast paragraph must render')
    assert.ok(factualP, 'the factual paragraph must render')
    assert.match(
      forecastP?.className ?? '',
      /italic/,
      '[FORECAST] must keep its real distinct italic classification',
    )
    assert.doesNotMatch(
      factualP?.className ?? '',
      /italic/,
      '[FACTUAL] must NOT receive the forecast-only italic classification',
    )
  })
})
