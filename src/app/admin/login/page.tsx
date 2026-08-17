/**
 * AIscentra — Admin Login (magic link)
 *
 * Recovered verbatim from an early project archive (Readiness Assessment
 * Blocker B-02) -- pure auth, no dependency on the V1/V2 schema, so no
 * adaptation was needed.
 *
 * Frontend Design Foundation, layer 6: the real supabase.auth.signInWithOtp
 * call, the real emailRedirectTo pointing at /auth/callback (the real
 * production bug fix documented below, unchanged), and all real
 * loading/sent/error state are completely UNCHANGED -- only the visual
 * JSX is migrated to vfinal.
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
    <div className="flex min-h-screen items-center justify-center bg-deep-obsidian px-6 text-frost">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <span className="font-caption mb-2 block text-mint-signal">INTELLIGENCE OBSERVATORY</span>
          <h1 className="font-heading text-2xl text-frost">Admin Access</h1>
        </div>

        {sent ? (
          <div className="border border-border-subtle bg-surface-tonal p-6 text-center">
            <span className="font-caption mb-2 block text-silver-haze">CHECK EMAIL</span>
            <p className="text-silver-haze">
              Magic link sent to <strong className="text-frost">{email}</strong>
            </p>
            <p className="mt-2 text-xs text-silver-haze">
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
              <label htmlFor="email" className="font-caption mb-1 block text-silver-haze">
                ADMIN EMAIL
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="admin@aiscentra.com"
                className="observatory-input font-body w-full border border-border-subtle bg-surface-tonal px-4 py-2.5 text-frost placeholder-silver-haze"
              />
            </div>

            {error && <p className="font-mono text-xs text-red-400">{error}</p>}

            <button
              type="submit"
              disabled={loading || !email}
              className="btn-pill magnetic w-full text-xs disabled:opacity-40"
            >
              {loading ? 'SENDING...' : 'SEND MAGIC LINK'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
