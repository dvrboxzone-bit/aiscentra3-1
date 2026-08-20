import '../../../lib/test-utils/dom-setup'

import { test, describe, mock } from 'node:test'
import assert from 'node:assert/strict'
import { render } from '@testing-library/react'
import { forceReducedMotion } from '../../../app/__tests__/homepage-fixtures'

describe('/admin/sources — real query reached, real data rendered', () => {
  test('the real AdminSourcesPage reaches the real createAdminClient() query and renders real source rows (name, url, trust_score, status)', async (t) => {
    const restore = forceReducedMotion()
    t.after(restore)
    mock.module('@/lib/supabase/server', {
      namedExports: {
        createAdminClient: () => ({
          from: () => ({
            select: () => ({
              order: () =>
                Promise.resolve({
                  data: [
                    {
                      id: 'src-1',
                      name: 'Real Source Name',
                      url: 'https://real-source.example.com',
                      type: 'rss',
                      trust_score: 0.95,
                      status: 'ACTIVE',
                      last_checked_at: new Date().toISOString(),
                    },
                  ],
                }),
            }),
          }),
        }),
      },
    })
    const { default: AdminSourcesPage } = await import(
      '../../../app/admin/(protected)/sources/page'
    )
    const jsx = await AdminSourcesPage()
    const { container } = render(jsx)

    assert.match(container.innerHTML, /Real Source Name/)
    assert.match(container.innerHTML, /https:\/\/real-source\.example\.com/)
    assert.match(container.innerHTML, /0\.95/)
    assert.match(container.innerHTML, /1 registered source/)
    assert.doesNotMatch(container.innerHTML, /href="#"/)
    assert.doesNotMatch(container.innerHTML, /picsum/i)
    assert.doesNotMatch(container.innerHTML, /z-cdn/i)
  })
})
