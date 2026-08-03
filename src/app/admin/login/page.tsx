/**
 * AIscentra — Admin Login (magic link)
 *
 * Recovered verbatim from an early project archive (Readiness Assessment
 * Blocker B-02) -- pure auth, no dependency on the V1/V2 schema, so no
 * adaptation was needed.
 */
'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function AdminLoginPage(): React.JSX.Element {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setLoading(true)
    setError('')

    const supabase = createClient()
    const { error: authError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        // Real production bug, confirmed live: this previously pointed
        // directly at `${origin}/admin`, completely bypassing
        // /auth/callback -- the ONLY route that actually calls
        // exchangeCodeForSession(). Supabase's magic-link verify
        // endpoint redirects the browser straight to whatever
        // emailRedirectTo says; pointing it at /admin meant the PKCE
        // code arrived as `/admin?code=...` with nothing in the app
        // ever exchanging it for a session, so the admin layout's own
        // getUser() check correctly saw no session and bounced back to
        // /admin/login every time -- an infinite-seeming loop that was
        // actually a missing exchange step, not a redirect bug. Fixed
        // by pointing at /auth/callback, which exchanges the code and
        // THEN redirects to /admin (its own default `next` value) once
        // a real session exists.
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    })

    if (authError) {
      setError(authError.message)
      setLoading(false)
    } else {
      setSent(true)
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-observatory-black">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="mb-2 font-mono text-xs tracking-[0.3em] text-text-muted">
            INTELLIGENCE OBSERVATORY
          </p>
          <h1 className="text-xl font-light text-text-primary">Admin Access</h1>
        </div>

        {sent ? (
          <div className="border border-observatory-border bg-observatory-surface p-6 text-center">
            <p className="mb-2 font-mono text-xs tracking-wider text-text-muted">CHECK EMAIL</p>
            <p className="text-sm text-text-secondary">
              Magic link sent to <strong>{email}</strong>
            </p>
            <p className="mt-2 text-xs text-text-muted">
              Click the link in your email to access the admin panel.
            </p>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              void handleSubmit(e)
            }}
            className="space-y-4"
          >
            <div>
              <label
                htmlFor="email"
                className="mb-1 block font-mono text-xs tracking-wider text-text-muted"
              >
                ADMIN EMAIL
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="admin@aiscentra.com"
                className="w-full border border-observatory-border bg-observatory-surface px-4 py-2.5 text-sm text-text-primary placeholder-text-muted outline-none transition-colors focus:border-text-muted"
              />
            </div>

            {error && <p className="font-mono text-xs text-red-400">{error}</p>}

            <button
              type="submit"
              disabled={loading || !email}
              className="w-full border border-observatory-border py-2.5 font-mono text-xs tracking-wider text-text-muted transition-colors hover:border-text-muted hover:text-text-secondary disabled:opacity-40"
            >
              {loading ? 'SENDING...' : 'SEND MAGIC LINK'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
