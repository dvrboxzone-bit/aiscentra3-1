import '../../../lib/test-utils/dom-setup'

import { test, describe, mock } from 'node:test'
import assert from 'node:assert/strict'
import { forceReducedMotion } from '../../../app/__tests__/homepage-fixtures'

describe('/admin (protected) layout — real auth gate: unauthenticated redirect', () => {
  test('the real AdminLayout calls the real Next.js redirect() to /admin/login when supabase.auth.getUser() returns no user -- never renders admin content', async (t) => {
    const restore = forceReducedMotion()
    t.after(restore)
    mock.module('@/lib/supabase/server', {
      namedExports: {
        createClient: async () => ({
          auth: { getUser: async () => ({ data: { user: null } }) },
        }),
        createAdminClient: () => {
          throw new Error(
            'createAdminClient (admin_users lookup) must not be reached for an unauthenticated visitor',
          )
        },
      },
    })
    const { default: AdminLayout } = await import('../../../app/admin/(protected)/layout')

    await assert.rejects(
      () => AdminLayout({ children: null }),
      (err: unknown) => {
        const digest = (err as { digest?: string }).digest ?? ''
        assert.match(
          digest,
          /^NEXT_REDIRECT;/,
          'the real Next.js redirect() error digest must exist',
        )
        assert.match(digest, /;\/admin\/login;/, 'the real redirect target must be /admin/login')
        return true
      },
    )
  })
})
