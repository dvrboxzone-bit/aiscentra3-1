import '../../../lib/test-utils/dom-setup'

import { test, describe, mock } from 'node:test'
import assert from 'node:assert/strict'
import { render } from '@testing-library/react'
import { forceReducedMotion } from '../../../app/__tests__/homepage-fixtures'

describe('/admin (protected) layout — real admin gets VfinalAdminShell exactly once, with real content', () => {
  test('the real AdminLayout renders VfinalAdminShell (nav, real user email, real sign-out path) exactly once, with the real children content inside', async (t) => {
    const restore = forceReducedMotion()
    t.after(restore)
    mock.module('@/lib/supabase/server', {
      namedExports: {
        createClient: async () => ({
          auth: {
            getUser: async () => ({ data: { user: { email: 'real-admin@aiscentra.com' } } }),
          },
        }),
        createAdminClient: () => ({
          from: () => ({
            select: () => ({
              eq: () => ({
                single: async () => ({ data: { email: 'real-admin@aiscentra.com' }, error: null }),
              }),
            }),
          }),
        }),
      },
    })
    const { default: AdminLayout } = await import('../../../app/admin/(protected)/layout')
    const jsx = await AdminLayout({ children: 'REAL_ADMIN_CONTENT_MARKER' })
    const { container } = render(jsx)

    assert.match(
      container.innerHTML,
      /REAL_ADMIN_CONTENT_MARKER/,
      'the real protected children must render for an admin',
    )
    assert.match(
      container.innerHTML,
      /real-admin@aiscentra\.com/,
      'the real admin user email must render',
    )

    // Admin shell present exactly once (no duplication risk since
    // AdminLayout is the single wrapping point).
    const asides = container.querySelectorAll('aside')
    assert.equal(asides.length, 1, 'the admin shell (its own sidebar) must appear exactly once')

    for (const href of ['/admin', '/admin/signals', '/admin/sources', '/admin/pipeline']) {
      assert.ok(
        container.querySelector(`a[href="${href}"]`),
        `the real nav link ${href} must exist`,
      )
    }
    assert.doesNotMatch(container.innerHTML, /href="#"/)
    assert.doesNotMatch(container.innerHTML, /picsum/i)
    assert.doesNotMatch(container.innerHTML, /z-cdn/i)
  })
})
