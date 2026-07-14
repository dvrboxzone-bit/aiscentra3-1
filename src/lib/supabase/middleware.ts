/**
 * AIscentra — Supabase Middleware Helper
 *
 * Refreshes user session on every request.
 * Required by @supabase/ssr for cookie-based auth.
 */
import { createServerClient } from '@supabase/ssr'
import type { NextRequest, NextResponse } from 'next/server'
import { env } from '@/config/env'
import type { Database } from './types'

export async function updateSession(
  request: NextRequest,
  response: NextResponse,
): Promise<NextResponse> {
  const supabase = createServerClient<Database>(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        )
      },
    },
  })

  // Refresh session — do not remove this line
  await supabase.auth.getUser()

  return response
}
