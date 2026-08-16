'use client'

/**
 * AIscentra — vfinal Header (Frontend Design Foundation, layer 2)
 *
 * Ported from AIscentra-vfinal-adapt.html's own <header> markup
 * (lines ~244-279), preserving composition, block/subblock count, and
 * geometry exactly. NOT yet wired into any page's layout -- pages
 * adopt this component individually as they migrate (later layers),
 * so no not-yet-migrated page's current header changes yet.
 *
 * Real-route adaptation (required by task instructions -- "Удалить
 * пустые href='#'", "не создавать выдуманные... страницы"):
 * - Logo: href="#" -> "/"
 * - "Signals" dropdown: the HTML's own /signals/<category> paths do
 *   not exist as real routes -- the real category filter is
 *   /signals?category=<CATEGORY> (see src/app/signals/page.tsx's own
 *   category links). Same 9 categories, same order, real query-param
 *   hrefs.
 * - "Observations" (#news anchor in the HTML): mapped to /observatory,
 *   the real existing route covering this content.
 * - "Framework" dropdown: REAL BUG FIXED (independent review) --
 *   the HTML's own 4 sub-items (Epistemic Model, Methodology, Security
 *   & Data, Roadmap) originally pointed to href="#" with no
 *   corresponding real page. A prior version of this component
 *   collapsed the dropdown to a single link, removing the submenu
 *   entirely -- but the HTML's own dropdown IS a real block/subblock
 *   structure (4 distinct sub-items), and removing it violated the
 *   task's own explicit "не менять количество блоков/подблоков"
 *   constraint. Restored: the dropdown submenu (same 4 sub-items,
 *   same order) now links to real anchors on /about
 *   (/about#epistemic-model, /about#methodology, /about#security-data,
 *   /about#roadmap) -- fragments that will exist once /about migrates
 *   in a later layer and gains matching section ids. No fabricated
 *   page is created; every link resolves to the real, existing /about
 *   route.
 * - "Assistant": #assistant anchor -> /assistant (real route).
 * - "Help the project": kept as-is (mailto:, a valid, real anchor
 *   target, not a fabricated page).
 * - "Enter" CTA (#signals anchor): -> /signals (real route).
 *
 * Lenis/scroll-linked backdrop behavior arrives in layer 3 -- this
 * component's own markup and static styling are complete now.
 */
import Link from 'next/link'
import type { SignalCategory } from '@/types/database'

const SIGNAL_CATEGORIES: ReadonlyArray<{ value: SignalCategory; label: string }> = [
  { value: 'RESEARCH', label: 'Research' },
  { value: 'MODELS', label: 'Models' },
  { value: 'COMPANIES', label: 'Companies' },
  { value: 'INFRASTRUCTURE', label: 'Infrastructure' },
  { value: 'OPEN_SOURCE', label: 'Open Source' },
  { value: 'FUNDING', label: 'Funding' },
  { value: 'REGULATION', label: 'Regulation' },
  { value: 'AGENTS', label: 'Agents' },
  { value: 'HARDWARE', label: 'Hardware' },
]

export function VfinalHeader(): React.JSX.Element {
  return (
    <header
      id="header"
      className="fixed left-0 right-0 top-0 z-50 border-b border-border-subtle bg-[rgba(3,3,3,0.8)] backdrop-blur-md"
    >
      <nav className="mx-auto flex max-w-[1200px] items-center justify-between px-6 py-4">
        <Link
          href="/"
          className="flex items-center gap-4 text-lg font-bold tracking-tight text-frost"
        >
          <svg width="48" height="48">
            <use href="#aiscentra-logo" />
          </svg>
          <span>AIscentra</span>
        </Link>

        <div className="flex items-center gap-8">
          <div className="dropdown hide-mobile">
            <Link
              href="/signals"
              className="flex items-center gap-1 text-sm font-medium text-frost underline-offset-4 hover:underline"
            >
              Signals <span className="text-xs">▼</span>
            </Link>
            <div className="dropdown-content">
              {SIGNAL_CATEGORIES.map((cat) => (
                <Link key={cat.value} href={`/signals?category=${cat.value}`}>
                  {cat.label}
                </Link>
              ))}
            </div>
          </div>

          <Link
            href="/observatory"
            className="hide-mobile text-sm font-medium text-frost underline-offset-4 hover:underline"
          >
            Observations
          </Link>

          <div className="dropdown hide-mobile">
            <Link
              href="/about"
              className="flex items-center gap-1 text-sm font-medium text-frost underline-offset-4 hover:underline"
            >
              Framework <span className="text-xs">▼</span>
            </Link>
            <div className="dropdown-content">
              <Link href="/about#epistemic-model">Epistemic Model</Link>
              <Link href="/about#methodology">Methodology</Link>
              <Link href="/about#security-data">Security &amp; Data</Link>
              <Link href="/about#roadmap">Roadmap</Link>
            </div>
          </div>

          <Link
            href="/assistant"
            className="hide-mobile text-sm font-medium text-frost underline-offset-4 hover:underline"
          >
            Assistant
          </Link>

          <a
            href="mailto:contact@aiscentra.com"
            className="hide-mobile text-sm font-medium text-mint-signal underline-offset-4 hover:underline"
          >
            Help the project
          </a>

          <Link href="/signals" className="btn-pill magnetic text-sm">
            Enter ↗
          </Link>
        </div>
      </nav>
    </header>
  )
}
