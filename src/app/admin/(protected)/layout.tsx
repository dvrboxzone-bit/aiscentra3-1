/**
 * AIscentra — Admin Layout
 *
 * Auth gate: authenticated user's email must be in admin_users table.
 * Unauthenticated users are redirected to /admin/login.
 * Non-admin authenticated users see 403 (no internal state disclosed).
 *
 * Recovered from an early project archive (Readiness Assessment Blocker
 * B-02) that was never carried forward into the current codebase. The
 * admin_users table itself was never removed from the live schema.
 *
 * Frontend Design Foundation, layer 6: auth logic (getUser(),
 * admin_users lookup, redirect to /admin/login, 403 rendering) is
 * completely UNCHANGED from the pre-migration version -- only the
 * visual JSX is replaced, with VfinalAdminShell/VfinalAdminAccessDenied
 * mounted here, at the SAME single wrapping point every protected admin
 * page already used, so the shell can never be duplicated or nested.
 */
import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { VfinalAdminShell } from '@/components/layout/vfinal-admin-shell'
import { VfinalAdminAccessDenied } from '@/components/layout/vfinal-admin-access-denied'

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}): Promise<React.JSX.Element> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Not authenticated → redirect to login
  if (!user) {
    redirect('/admin/login')
  }

  // Check admin_users table — service role, bypasses RLS intentionally
  // (this IS the authorization check itself, not a query to protect).
  const adminClient = createAdminClient()
  const { data: adminRecord } = await adminClient
    .from('admin_users')
    .select('email')
    .eq('email', user.email ?? '')
    .single()

  if (!adminRecord) {
    return <VfinalAdminAccessDenied userEmail={user.email ?? ''} />
  }

  return <VfinalAdminShell userEmail={user.email ?? ''}>{children}</VfinalAdminShell>
}
