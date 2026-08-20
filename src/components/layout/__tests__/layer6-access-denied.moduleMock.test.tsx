import '../../../lib/test-utils/dom-setup'

import { test, describe, mock } from 'node:test'
import assert from 'node:assert/strict'
import { render } from '@testing-library/react'
import { forceReducedMotion } from '../../../app/__tests__/homepage-fixtures'

describe('/admin (protected) layout — real auth gate: authenticated non-admin gets 403, not admin content', () => {
  test('the real AdminLayout renders VfinalAdminAccessDenied (not VfinalAdminShell/children) when the real admin_users lookup finds no record for the authenticated user', async (t) => {
    const restore = forceReducedMotion()
    t.after(restore)
    mock.module('@/lib/supabase/server', {
      namedExports: {
        createClient: async () => ({
          auth: {
            getUser: async () => ({ data: { user: { email: 'not-an-admin@example.com' } } }),
          },
        }),
        createAdminClient: () => ({
          from: () => ({
            select: () => ({
              eq: () => ({
                single: async () => ({ data: null, error: { message: 'no rows' } }),
              }),
            }),
          }),
        }),
      },
    })
    const { default: AdminLayout } = await import('../../../app/admin/(protected)/layout')
    const jsx = await AdminLayout({ children: 'REAL_ADMIN_CONTENT_MARKER' })
    const { container } = render(jsx)

    assert.match(container.innerHTML, /ACCESS DENIED/, 'the real access-denied state must render')
    assert.match(
      container.innerHTML,
      /not-an-admin@example\.com/,
      'the real user email must render',
    )
    assert.doesNotMatch(
      container.innerHTML,
      /REAL_ADMIN_CONTENT_MARKER/,
      'the real protected children must NEVER render for a non-admin authenticated user',
    )
    assert.ok(
      container.querySelector('form[action="/auth/signout"]'),
      'the real /auth/signout form must exist',
    )
  })
})
