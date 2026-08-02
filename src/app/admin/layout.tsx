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
 */
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'

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
    return (
      <div className="flex min-h-screen items-center justify-center bg-observatory-black">
        <div className="text-center">
          <p className="mb-2 font-mono text-xs tracking-wider text-text-muted">ACCESS DENIED</p>
          <p className="text-sm text-text-muted">
            {user.email} is not an Observatory administrator.
          </p>
          <form action="/auth/signout" method="post" className="mt-4">
            <button
              type="submit"
              className="font-mono text-xs text-text-muted hover:text-text-secondary"
            >
              SIGN OUT
            </button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen bg-observatory-black">
      {/* Admin sidebar */}
      <aside className="relative w-52 shrink-0 border-r border-observatory-border">
        <div className="border-b border-observatory-border p-4">
          <p className="font-mono text-xs tracking-wider text-text-muted">ADMIN</p>
          <p className="mt-1 font-mono text-xs text-text-primary">AISCENTRA</p>
        </div>
        <nav className="space-y-1 p-3">
          {[
            { href: '/admin', label: 'Dashboard' },
            { href: '/admin/signals', label: 'Signals' },
            { href: '/admin/sources', label: 'Sources' },
            { href: '/admin/pipeline', label: 'Pipeline' },
          ].map(({ href, label }) => (
            <a
              key={href}
              href={href}
              className="block px-3 py-2 font-mono text-xs text-text-muted transition-colors hover:bg-observatory-surface hover:text-text-secondary"
            >
              {label.toUpperCase()}
            </a>
          ))}
        </nav>
        <div className="absolute bottom-0 w-52 border-t border-observatory-border p-3">
          <p className="truncate font-mono text-xs text-text-muted">{user.email}</p>
          <Link
            href="/"
            className="mt-1 block font-mono text-xs text-text-muted hover:text-text-secondary"
          >
            ← Observatory
          </Link>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto p-8">{children}</main>
    </div>
  )
}
