/**
 * AIscentra — Auth Sign Out
 *
 * NEW file, not present even in the original archive: the recovered
 * admin layout's "SIGN OUT" button posts to this exact path
 * (`<form action="/auth/signout" method="post">`), but the archive
 * never actually implemented the route -- the button would have been
 * a dead link. Implemented here so the recovered auth flow is
 * genuinely complete, not merely visually restored.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: Request): Promise<NextResponse> {
  const supabase = await createClient()
  await supabase.auth.signOut()

  const { origin } = new URL(request.url)
  return NextResponse.redirect(`${origin}/admin/login`, { status: 303 })
}
