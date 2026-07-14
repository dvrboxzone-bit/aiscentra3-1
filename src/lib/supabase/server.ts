/**
 * AIscentra — Supabase Server Client
 *
 * Used in Server Components, Route Handlers, and Server Actions.
 * Reads/writes cookies for session management.
 *
 * For admin operations requiring service role (bypasses RLS),
 * use createAdminClient() — only in trusted server contexts.
 */
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { env, serverEnv } from '@/config/env'
import type { Database } from './types'

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient<Database>(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          )
        } catch {
          // setAll called from a Server Component — safe to ignore
          // Middleware handles session refresh
        }
      },
    },
  })
}

/**
 * Admin client — bypasses Row Level Security.
 * Use ONLY for:
 * - Scheduled pipeline operations (Signal Engine, Event Generator)
 * - Admin API routes with verified admin session
 * NEVER expose this client to the browser.
 */
export function createAdminClient() {
  return createServerClient<Database>(env.SUPABASE_URL, serverEnv.SUPABASE_SERVICE_ROLE_KEY, {
    cookies: { getAll: () => [], setAll: () => {} },
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
