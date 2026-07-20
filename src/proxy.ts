/**
 * AIscentra — Next.js Middleware
 *
 * Responsibilities:
 * 1. Refresh Supabase session on every request
 * 2. Protect /admin routes — redirect unauthenticated users
 *
 * Readiness Assessment Blocker B-02:
 * Admin authentication defined here. /admin requires authenticated session.
 * Admin email validation happens in the admin layout Server Component.
 */
import { type NextRequest, NextResponse } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const response = NextResponse.next({ request })
  // Pass pathname to layouts for active nav detection
  response.headers.set('x-pathname', request.nextUrl.pathname)
  return updateSession(request, response)
}

export const config = {
  matcher: [
    /*
     * Run proxy on all routes except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     * - Public assets
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
