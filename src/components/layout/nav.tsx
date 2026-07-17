import Link from 'next/link'
import { Pulse } from '@/components/ui/pulse'
import { cn } from '@/lib/utils/cn'

const NAV_LINKS = [
  { href: '/signals',     label: 'Signals' },
  { href: '/events',      label: 'Events' },
  { href: '/reports',     label: 'Reports' },
  { href: '/assistant',   label: 'Assistant' },
  { href: '/observatory', label: 'Observatory' },
] as const

interface NavProps {
  currentPath?: string
}

export function Nav({ currentPath }: NavProps): React.JSX.Element {
  return (
    <header className="sticky top-0 z-50 border-b border-observatory-border bg-observatory-black/95 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-6">

        {/* Logo */}
        <Link href="/" className="flex shrink-0 items-center gap-2.5 group">
          <Pulse size="sm" />
          <span className="font-mono text-sm tracking-[0.15em] text-text-primary transition-opacity group-hover:opacity-80">
            AISCENTRA
          </span>
        </Link>

        {/* Navigation */}
        <nav className="hidden items-center gap-1 md:flex" aria-label="Primary navigation">
          {NAV_LINKS.map(({ href, label }) => {
            const isActive = currentPath?.startsWith(href)
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'px-3 py-1.5 text-xs tracking-wider transition-colors',
                  isActive
                    ? 'text-text-primary'
                    : 'text-text-muted hover:text-text-secondary',
                )}
              >
                {label.toUpperCase()}
              </Link>
            )
          })}
        </nav>

        {/* Search + status */}
        <div className="flex items-center gap-3">
          {/* Inline search */}
          <form method="GET" action="/search" className="hidden sm:block">
            <input
              type="search"
              name="q"
              placeholder="Search..."
              className="w-36 border border-observatory-border bg-transparent px-3 py-1 text-xs text-text-muted placeholder-text-muted outline-none focus:border-text-muted focus:w-48 transition-all"
            />
          </form>
          <span className="hidden text-xs text-text-muted lg:block">OBSERVING</span>
          <Pulse size="sm" />
        </div>
      </div>
    </header>
  )
}
