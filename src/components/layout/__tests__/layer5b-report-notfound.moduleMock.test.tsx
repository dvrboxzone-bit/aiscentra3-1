import '../../../lib/test-utils/dom-setup'

import { test, describe, mock } from 'node:test'
import assert from 'node:assert/strict'
import { forceReducedMotion } from '../../../app/__tests__/homepage-fixtures'

describe('/reports/[slug] — real notFound() behavior', () => {
  test('the real /reports/[slug] page calls the real Next.js notFound() when the real getReportById returns null', async (t) => {
    const restore = forceReducedMotion()
    t.after(restore)
    mock.module('@/modules/reports/queries', {
      namedExports: { getReportById: async () => null },
    })
    const { default: ReportPage } = await import('../../../app/(public)/reports/[slug]/page')
    await assert.rejects(
      () => ReportPage({ params: Promise.resolve({ slug: 'missing-report' }) }),
      (err: unknown) => {
        const digest = (err as { digest?: string }).digest ?? ''
        assert.match(digest, /404/, 'the real Next.js notFound() error digest must contain 404')
        return true
      },
    )
  })
})
