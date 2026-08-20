import '../../../lib/test-utils/dom-setup'

import { test, describe, mock } from 'node:test'
import assert from 'node:assert/strict'
import { render, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { forceReducedMotion } from '../../../app/__tests__/homepage-fixtures'

describe('/admin/login — real magic-link form calls the real signInWithOtp with /auth/callback', () => {
  test('submitting the real form calls the real supabase.auth.signInWithOtp() with the real email and the real /auth/callback redirect target, then shows the real "sent" confirmation', async (t) => {
    const restore = forceReducedMotion()
    t.after(restore)
    let capturedEmail: string | null = null
    let capturedRedirect: string | null = null

    mock.module('@/lib/supabase/client', {
      namedExports: {
        createClient: () => ({
          auth: {
            signInWithOtp: async (args: {
              email: string
              options: { emailRedirectTo: string }
            }) => {
              capturedEmail = args.email
              capturedRedirect = args.options.emailRedirectTo
              return { error: null }
            },
          },
        }),
      },
    })
    const { default: AdminLoginPage } = await import('../../../app/admin/login/page')
    const { container } = render(React.createElement(AdminLoginPage))

    const input = container.querySelector('input#email') as HTMLInputElement
    const form = container.querySelector('form') as HTMLFormElement
    assert.ok(input, 'the real email input must exist')
    assert.ok(form, 'the real form must exist')

    fireEvent.change(input, { target: { value: 'real-admin@aiscentra.com' } })
    fireEvent.submit(form)

    await waitFor(() => {
      assert.equal(
        capturedEmail,
        'real-admin@aiscentra.com',
        'the real typed email must reach signInWithOtp()',
      )
    })
    assert.match(
      capturedRedirect ?? '',
      /\/auth\/callback$/,
      'the real redirect must point at /auth/callback (built from the real window.location.origin), the ONLY route that exchanges the PKCE code',
    )
    await waitFor(() => {
      assert.match(
        container.innerHTML,
        /CHECK EMAIL/,
        'the real "sent" confirmation state must render',
      )
    })
  })
})
