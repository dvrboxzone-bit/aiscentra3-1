import Link from 'next/link'

export function Footer(): React.JSX.Element {
  return (
    <footer className="border-t border-observatory-border">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-6 py-8 sm:flex-row">
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs tracking-[0.15em] text-text-muted">AISCENTRA</span>
          <span className="text-observatory-border">·</span>
          <span className="text-xs text-text-muted">Intelligence Observatory</span>
        </div>

        <nav className="flex items-center gap-6" aria-label="Footer navigation">
          {[
            { href: '/signals',   label: 'Signals' },
            { href: '/events',    label: 'Events' },
            { href: '/reports',   label: 'Reports' },
            { href: '/about',     label: 'About' },
          ].map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className="text-xs text-text-muted transition-colors hover:text-text-secondary"
            >
              {label}
            </Link>
          ))}
        </nav>

        <p className="text-xs text-text-muted">
          Observe. Analyze. Accelerate.
        </p>
      </div>
    </footer>
  )
}
