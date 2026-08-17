import Link from 'next/link'

/**
 * AIscentra — vfinal admin shell (Frontend Design Foundation, layer 6)
 *
 * The single, unified visual wrapper for every protected admin page --
 * mounted exactly once, in `src/app/admin/(protected)/layout.tsx`
 * (the SAME single wrapping point the admin route group already used
 * before this migration, so no page can accidentally nest or
 * duplicate this shell). NOT the public VfinalPublicShell -- admin has
 * its own sidebar navigation, own auth-aware user footer, no
 * Lenis/globe/marketing chrome.
 *
 * Same real nav items, same real hrefs (/admin, /admin/signals,
 * /admin/sources, /admin/pipeline), same real user email display and
 * real /auth/signout form action, same real "back to Observatory"
 * link (/) as the pre-migration sidebar -- only the visual language
 * (vfinal color tokens/typography) changed.
 */
export function VfinalAdminShell({
  userEmail,
  children,
}: {
  userEmail: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex min-h-screen bg-deep-obsidian text-frost">
      <aside className="relative w-52 shrink-0 border-r border-border-subtle bg-surface-tonal">
        <div className="border-b border-border-subtle p-4">
          <span className="font-caption block text-silver-haze">ADMIN</span>
          <p className="mt-1 font-mono text-xs text-frost">AISCENTRA</p>
        </div>
        <nav className="space-y-1 p-3">
          {[
            { href: '/admin', label: 'Dashboard' },
            { href: '/admin/signals', label: 'Signals' },
            { href: '/admin/sources', label: 'Sources' },
            { href: '/admin/pipeline', label: 'Pipeline' },
          ].map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className="block px-3 py-2 text-xs font-medium text-silver-haze transition-colors hover:bg-deep-obsidian hover:text-mint-signal"
            >
              {label.toUpperCase()}
            </Link>
          ))}
        </nav>
        <div className="absolute bottom-0 w-52 border-t border-border-subtle p-3">
          <p className="truncate font-mono text-xs text-silver-haze">{userEmail}</p>
          <Link
            href="/"
            className="font-caption mt-1 block text-silver-haze transition-colors hover:text-mint-signal"
          >
            ← Observatory
          </Link>
        </div>
      </aside>

      <main className="flex-1 overflow-auto p-8">{children}</main>
    </div>
  )
}
