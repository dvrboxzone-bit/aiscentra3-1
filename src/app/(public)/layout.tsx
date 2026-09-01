import { VfinalPublicShell } from '@/components/layout/vfinal-public-shell'

/**
 * AIscentra — (public) route group layout.
 *
 * Real architectural fix (explicit owner instruction, Task 7,
 * 2026-09-01): VfinalPublicShell (header, footer, and critically the
 * Assistant panel + edge tab + their shared context) was previously
 * duplicated inside each of 19 individual page.tsx files. Since each
 * page's own shell instance was a distinct React tree, navigating
 * between pages unmounted the old page's shell and mounted a fresh
 * one on the new page -- silently resetting the Assistant panel's
 * open/closed state (and any future conversation state) on every
 * single navigation, not just on a hard reload.
 *
 * Fixed by mounting VfinalPublicShell exactly ONCE here, in a real
 * Next.js App Router route group layout -- NOT in the true root
 * layout.tsx, which is deliberately kept minimal (html/body only)
 * because it is shared by literally everything in this app,
 * including the password-protected /admin panel (its own separate
 * layout) and API routes. Wrapping the true root would have leaked
 * the public marketing header/footer/Assistant tab onto the admin
 * panel as an unintended side effect -- confirmed as a real risk by
 * reading admin's own separate layout.tsx before choosing this
 * route-group approach instead.
 *
 * All 19 real public pages were moved into this (public) group
 * (a route group -- the parentheses are excluded from the real URL,
 * so /signals is still served at exactly /signals, not
 * /public/signals). Each page's own former direct
 * <VfinalPublicShell>...</VfinalPublicShell> wrapper was replaced
 * with a React Fragment (<>...</>) to preserve valid single-root JSX
 * without relying on VfinalPublicShell's own markup, which now lives
 * here instead.
 */
export default function PublicLayout({
  children,
}: {
  children: React.ReactNode
}): React.JSX.Element {
  return <VfinalPublicShell>{children}</VfinalPublicShell>
}
