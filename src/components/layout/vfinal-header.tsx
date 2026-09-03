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
 *   /signals?category=<CATEGORY> (see src/app/(public)/signals/page.tsx's own
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
 * - "Subscribe" CTA (explicit owner instruction, 2026-08-27, real route
 *   change): -> /subscribe (was "Enter" -> /signals; the direct link
 *   to /signals itself is NOT lost -- it remains reachable via the
 *   real "ALL" item inside the existing "Signals ▼" dropdown, and via
 *   a separate plain link inside the mobile menu -- confirmed by
 *   direct code read before this change was made).
 *
 * Lenis/scroll-linked backdrop behavior arrives in layer 3 -- this
 * component's own markup and static styling are complete now.
 *
 * REAL BUG FIXED (Public Interactivity Correction checkpoint,
 * confirmed defect #2): "Assistant" pointed at the `/assistant` route
 * instead of the homepage's own `#assistant` section (a real, existing
 * `<section id="assistant">` on `/`, see src/app/page.tsx) -- clicking
 * it from the homepage navigated away instead of scrolling to that
 * section. Now a client component (`usePathname`) so the href can
 * differ by route: `#assistant` on the homepage itself, `/#assistant`
 * from every other route (Next.js navigates to `/` then jumps to the
 * fragment). The standalone `/assistant` page and its own form/action
 * are unchanged. On the homepage, the click is intercepted to scroll
 * via the active Lenis instance (when one exists) so the jump is
 * smooth and consistent with the rest of the page's own scroll
 * behavior, instead of a native instant jump that would fight Lenis's
 * virtual scroll position.
 */
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { SignalCategory } from '@/types/database'
import { getActiveLenisInstance } from './vfinal-lenis-provider'
import { useAssistantPanel } from './vfinal-assistant-context'

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
  const pathname = usePathname()
  const { open: openAssistant } = useAssistantPanel()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const menuCloseRef = useRef<HTMLButtonElement>(null)
  const menuPanelRef = useRef<HTMLDivElement>(null)

  const closeMobileMenu = useCallback((restoreFocus = true): void => {
    setMenuOpen(false)
    if (restoreFocus) window.setTimeout(() => menuButtonRef.current?.focus(), 0)
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    getActiveLenisInstance()?.stop()
    // Let the opener's click finish before moving focus into the dialog.
    // A synchronous effect focus can be overwritten by the browser's
    // post-click focus handling in real Chrome.
    const focusTimer = window.setTimeout(() => menuCloseRef.current?.focus(), 50)

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeMobileMenu()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = Array.from(
        menuPanelRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') ??
          [],
      )
      const first = focusable.at(0)
      const last = focusable.at(-1)
      if (!first || !last) return
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    const handleResize = (): void => {
      if (window.innerWidth > 768) closeMobileMenu(false)
    }
    document.addEventListener('keydown', handleKeyDown)
    window.addEventListener('resize', handleResize)

    return () => {
      window.clearTimeout(focusTimer)
      document.body.style.overflow = previousOverflow
      getActiveLenisInstance()?.start()
      document.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('resize', handleResize)
    }
  }, [closeMobileMenu, menuOpen])

  useEffect(() => {
    setMenuOpen(false)
  }, [pathname])

  const handleAssistantClick = (e: React.MouseEvent): void => {
    e.preventDefault()
    closeMobileMenu(false)
    openAssistant()
  }

  return (
    <>
      <header
        id="header"
        className="fixed left-0 right-0 top-0 z-50 border-b border-border-subtle bg-[rgba(3,3,3,0.8)] backdrop-blur-md"
      >
        <nav className="mx-auto flex max-w-[1200px] items-center justify-between px-6 py-4">
          <Link href="/" aria-label="AIscentra — home" className="flex items-center">
            <svg width="140" height="56">
              <use href="#aiscentra-logo" />
            </svg>
          </Link>

          <div className="flex items-center gap-8">
            <div className="dropdown hide-mobile">
              <button
                type="button"
                className="flex items-center gap-1 text-sm font-medium text-frost underline-offset-4 hover:underline"
                aria-haspopup="true"
              >
                Signals <span className="text-xs">▼</span>
              </button>
              <div className="dropdown-content">
                <Link href="/signals">ALL</Link>
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
              <button
                type="button"
                className="flex items-center gap-1 text-sm font-medium text-frost underline-offset-4 hover:underline"
                aria-haspopup="true"
              >
                Research <span className="text-xs">▼</span>
              </button>
              <div className="dropdown-content">
                <Link href="/trajectories">Trajectories</Link>
                <Link href="/forecasts">Forecasts</Link>
                <Link href="/editorial">Editorial</Link>
                <Link href="/emerging-patterns">Emerging Patterns</Link>
                <Link href="/strategic-memory">Strategic Memory</Link>
                <Link href="/status">Status Page</Link>
              </div>
            </div>

            <div className="dropdown hide-mobile">
              <button
                type="button"
                className="flex items-center gap-1 text-sm font-medium text-frost underline-offset-4 hover:underline"
                aria-haspopup="true"
              >
                Observatory <span className="text-xs">▼</span>
              </button>
              <div className="dropdown-content">
                <Link href="/about">About</Link>
                <Link href="/about#team">Team</Link>
                <Link href="/contact">Contact</Link>
                <button type="button" onClick={handleAssistantClick}>
                  Assistant
                </button>
              </div>
            </div>

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

            <a
              href="mailto:aiscentra@gmail.com"
              className="hide-mobile text-sm font-medium text-mint-signal underline-offset-4 hover:underline"
            >
              Help the project
            </a>

            <Link href="/subscribe" className="btn-pill magnetic hide-mobile text-sm">
              Subscribe ↗
            </Link>

            <button
              ref={menuButtonRef}
              type="button"
              className="hamburger-btn"
              aria-label="Open navigation menu"
              aria-expanded={menuOpen}
              aria-controls="mobile-menu-panel"
              onClick={() => setMenuOpen(true)}
            >
              <span />
              <span />
              <span />
            </button>
          </div>
        </nav>
      </header>

      <button
        type="button"
        className={`mobile-menu-overlay ${menuOpen ? 'open' : ''}`}
        aria-label="Close menu overlay"
        tabIndex={-1}
        onClick={() => closeMobileMenu()}
      />
      <div
        ref={menuPanelRef}
        id="mobile-menu-panel"
        className={`mobile-menu-panel ${menuOpen ? 'open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Mobile navigation"
        aria-hidden={!menuOpen}
        {...(!menuOpen ? { inert: true } : {})}
      >
        <div className="mobile-menu-head">
          <span className="font-caption text-silver-haze">Navigation</span>
          <button
            ref={menuCloseRef}
            type="button"
            className="mobile-menu-close"
            aria-label="Close navigation menu"
            onClick={() => closeMobileMenu()}
          >
            ×
          </button>
        </div>

        <nav aria-label="Mobile navigation links" className="mobile-menu-scroll">
          <span className="mobile-menu-group-label">SIGNALS</span>
          <Link href="/signals" onClick={() => closeMobileMenu(false)}>
            All signals
          </Link>
          {SIGNAL_CATEGORIES.map((category) => (
            <Link
              key={category.value}
              href={`/signals?category=${category.value}`}
              onClick={() => closeMobileMenu(false)}
            >
              {category.label}
            </Link>
          ))}

          <span className="mobile-menu-group-label">RESEARCH</span>
          <Link href="/trajectories" onClick={() => closeMobileMenu(false)}>
            Trajectories
          </Link>
          <Link href="/forecasts" onClick={() => closeMobileMenu(false)}>
            Forecasts
          </Link>
          <Link href="/editorial" onClick={() => closeMobileMenu(false)}>
            Editorial
          </Link>
          <Link href="/emerging-patterns" onClick={() => closeMobileMenu(false)}>
            Emerging Patterns
          </Link>
          <Link href="/strategic-memory" onClick={() => closeMobileMenu(false)}>
            Strategic Memory
          </Link>
          <Link href="/status" onClick={() => closeMobileMenu(false)}>
            Status Page
          </Link>

          <span className="mobile-menu-group-label">EXPLORE</span>
          <Link href="/observatory" onClick={() => closeMobileMenu(false)}>
            Observations
          </Link>
          <button type="button" onClick={handleAssistantClick}>
            Assistant
          </button>

          <span className="mobile-menu-group-label">FRAMEWORK</span>
          <Link href="/about#epistemic-model" onClick={() => closeMobileMenu(false)}>
            Epistemic Model
          </Link>
          <Link href="/about#methodology" onClick={() => closeMobileMenu(false)}>
            Methodology
          </Link>
          <Link href="/about#security-data" onClick={() => closeMobileMenu(false)}>
            Security &amp; Data
          </Link>
          <Link href="/about#roadmap" onClick={() => closeMobileMenu(false)}>
            Roadmap
          </Link>

          <a href="mailto:aiscentra@gmail.com" onClick={() => closeMobileMenu(false)}>
            Help the project
          </a>
          <Link
            href="/subscribe"
            className="btn-pill mt-4 justify-center"
            onClick={() => closeMobileMenu(false)}
          >
            Subscribe ↗
          </Link>
        </nav>
      </div>
    </>
  )
}
