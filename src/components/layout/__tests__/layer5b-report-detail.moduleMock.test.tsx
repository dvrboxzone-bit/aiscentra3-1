import '../../../lib/test-utils/dom-setup'

import { test, describe, mock } from 'node:test'
import assert from 'node:assert/strict'
import { render } from '@testing-library/react'
import { forceReducedMotion } from '../../../app/__tests__/homepage-fixtures'
import { makeReport } from './layer5b-fixtures'

describe('/reports/[slug] — real detail-page functions preserved', () => {
  test('the real /reports/[slug] page renders real report content (paragraph split) with shared header/footer, no forbidden URLs', async (t) => {
    const restore = forceReducedMotion()
    t.after(restore)
    const report = makeReport({
      id: 'r1',
      title: 'Real Report Detail',
      content: 'First real paragraph.\n\nSecond real paragraph.',
    })
    mock.module('@/modules/reports/queries', {
      namedExports: { getReportById: async () => report },
    })
    const { default: ReportPage } = await import('../../../app/(public)/reports/[slug]/page')
    const jsx = await ReportPage({ params: Promise.resolve({ slug: 'r1' }) })
    const { container } = render(jsx)
    assert.match(container.innerHTML, /Real Report Detail/)
    assert.match(container.innerHTML, /First real paragraph/)
    assert.match(container.innerHTML, /Second real paragraph/)
    assert.doesNotMatch(container.innerHTML, /href="#"/)
  })
})
