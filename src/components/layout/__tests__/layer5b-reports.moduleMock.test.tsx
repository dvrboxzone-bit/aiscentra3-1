import '../../../lib/test-utils/dom-setup'

import { test, describe, mock } from 'node:test'
import assert from 'node:assert/strict'
import { render } from '@testing-library/react'
import { forceReducedMotion } from '../../../app/__tests__/homepage-fixtures'
import { makeReport } from './layer5b-fixtures'

describe('/reports — real query preserved, VfinalPublicShell, no forbidden URLs, real type map', () => {
  test('the real /reports page renders real reports with shared header/footer, real /reports/[id] links, and the real report-type legend (labels + descriptions)', async (t) => {
    const restore = forceReducedMotion()
    t.after(restore)
    const reports = [
      makeReport({ id: 'r1', title: 'Real Report One' }),
      makeReport({ id: 'r2', title: 'Real Report Two' }),
    ]
    mock.module('@/modules/reports/queries', {
      namedExports: { getReports: async () => reports },
    })
    const { default: ReportsPage } = await import('../../../app/reports/page')
    const jsx = await ReportsPage()
    const { container } = render(jsx)
    assert.match(container.innerHTML, /Real Report One/)
    assert.match(container.innerHTML, /Real Report Two/)
    assert.ok(container.querySelector('a[href="/reports/r1"]'))
    assert.ok(container.querySelector('header#header'))
    assert.ok(container.querySelector('footer#footer'))
    assert.doesNotMatch(container.innerHTML, /href="#"/)
    assert.doesNotMatch(container.innerHTML, /picsum/i)
    assert.doesNotMatch(container.innerHTML, /z-cdn/i)

    // Real REPORT_TYPE_LABELS / REPORT_TYPE_DESCRIPTIONS legend --
    // always rendered (independent of query result), the real 4
    // report types with their real, exact descriptions.
    assert.match(container.innerHTML, /Signal Brief/)
    assert.match(container.innerHTML, /Concise analysis of a single high-significance signal\./)
    assert.match(container.innerHTML, /Event Analysis/)
    assert.match(container.innerHTML, /Deep interpretation of a promoted ecosystem event\./)
    assert.match(container.innerHTML, /Weekly Review/)
    assert.match(container.innerHTML, /Trend Report/)
    assert.match(container.innerHTML, /Pattern analysis across a signal category over 30 days\./)
  })
})
