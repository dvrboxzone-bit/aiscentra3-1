import '../../../lib/test-utils/dom-setup'

import { test, describe, mock } from 'node:test'
import assert from 'node:assert/strict'
import { render } from '@testing-library/react'
import { forceReducedMotion } from '../../../app/__tests__/homepage-fixtures'
import { makeReport } from './layer5b-fixtures'

describe('/reports — real query preserved, VfinalPublicShell, no forbidden URLs', () => {
  test('the real /reports page renders real reports with shared header/footer and real /reports/[id] links', async (t) => {
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
  })
})
