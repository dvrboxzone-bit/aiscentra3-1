/**
 * AIscentra — Auth Callback
 *
 * Handles the redirect from Supabase magic link email.
 * Exchanges the code for a session, then redirects to /admin.
 *
 * Recovered verbatim from an early project archive (Readiness
 * Assessment Blocker B-02) -- pure auth, no schema dependency.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/admin'

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  // Auth failed — redirect to login with error
  return NextResponse.redirect(`${origin}/admin/login?error=auth_failed`)
}
