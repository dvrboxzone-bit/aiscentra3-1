/**
 * AIscentra — Supabase Browser Client
 *
 * Used in Client Components. Uses the anon key (public, safe for browser).
 * For server-side operations requiring elevated permissions, use server.ts.
 */
import { createBrowserClient } from '@supabase/ssr'
import { env } from '@/config/env'
import type { Database } from './types'

export function createClient() {
  return createBrowserClient<Database>(env.SUPABASE_URL, env.SUPABASE_ANON_KEY)
}
