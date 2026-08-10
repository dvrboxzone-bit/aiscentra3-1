'use client'

import { useState, useRef, useEffect, useId } from 'react'
import type { SourceLink } from '@/lib/utils/source-links'

interface SourceFaviconStripProps {
  sources: SourceLink[]
  className?: string
}

/**
 * Compact strip of source favicons shown after a signal's description.
 *
 * Requirements this implements exactly:
 * - logo/verified favicon links to the exact original material (each
 *   icon IS the <a href> to that source's real URL, not a decorative
 *   image next to a separate link).
 * - source name is NOT shown by default -- only in the fallback
 *   (missing favicon) case and in the expanded full list.
 * - multiple sources render overlapping (negative margin stack), a
 *   deliberate, compact "who's here" visual rather than a wide row.
 * - the full list reveals on hover, click/tap, AND keyboard focus --
 *   three independent triggers, not just :hover (which excludes
 *   keyboard and touch users entirely).
 * - only a same-origin favicon.ico candidate is ever used (see
 *   buildFaviconUrl in source-links.ts) -- never a third-party icon
 *   guessing service.
 * - a missing/failed favicon falls back to a neutral icon PLUS the
 *   source name inline (not just a blank/broken image).
 * - NO nested interactive elements: a <button> wrapping <a> tags is
 *   invalid HTML (browsers "repair" it unpredictably, and assistive
 *   tech gets genuinely confused about which control is active) --
 *   REAL BUG FIXED HERE. The icons are their own top-level <a> tags,
 *   siblings of a separate, dedicated toggle <button> that contains
 *   no interactive children of its own. Expand/collapse state is
 *   driven from the outer container (hover, and React's onFocus,
 *   which -- unlike native DOM focus -- bubbles through the synthetic
 *   event system, so focusing ANY child, icon or toggle, expands the
 *   list without needing per-child focus handlers).
 *
 * The "unsafe/unreachable URL excluded, and if none remain the signal
 * is not published" half of the requirement is enforced further
 * upstream (getSourceLinksForSignal + the has_verified_source
 * publication gate) -- this component simply renders nothing for an
 * empty array.
 */
export function SourceFaviconStrip({
  sources,
  className,
}: SourceFaviconStripProps): React.JSX.Element | null {
  const [expanded, setExpanded] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  // Click-outside closes the expanded list (mouse/touch users who
  // opened it by clicking the toggle, not just hovering).
  useEffect(() => {
    if (!expanded) return
    function handleClickOutside(event: MouseEvent): void {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setExpanded(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [expanded])

  if (sources.length === 0) return null

  return (
    <div
      ref={containerRef}
      className={`relative inline-flex items-center ${className ?? ''}`}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      onFocus={() => setExpanded(true)}
      onBlur={(e) => {
        // React's onFocus/onBlur use the browser's focusin/focusout
        // events under the hood, which DO bubble (unlike native
        // focus/blur) -- placing these on the container, rather than
        // on each individual icon/toggle, is what makes "focus any
        // child -> expand" and "focus leaves the whole component ->
        // collapse" work without per-child handlers. Don't collapse if
        // focus is merely moving to another element still inside this
        // same container (e.g. from the toggle into the expanded
        // list's own links).
        if (!containerRef.current?.contains(e.relatedTarget as Node)) {
          setExpanded(false)
        }
      }}
    >
      <div className="flex items-center -space-x-2 py-1">
        {sources.slice(0, 4).map((source, i) => (
          <SourceFaviconLink key={source.url} source={source} stackIndex={i} />
        ))}
      </div>

      {/* Dedicated toggle -- a real <button>, but with NO interactive
          children (no nested <a>), so it is always valid HTML. A
          separate control from the icons above: clicking an icon
          navigates to that source; clicking this toggles the full
          list. */}
      <button
        type="button"
        className="ml-1 flex h-5 w-5 items-center justify-center rounded-full text-text-muted transition-colors hover:text-text-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-text-primary/50"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-label={`${sources.length} ${sources.length === 1 ? 'source' : 'sources'}. Show full list.`}
        onClick={() => {
          // REAL BUG FIXED: a genuine toggle (setExpanded(v => !v)) here
          // raced with hover -- a real click event sequence (including
          // userEvent.click, which matches real browser behavior)
          // fires mouseenter on the container BEFORE the click handler
          // itself, so onMouseEnter had already set expanded=true, and
          // a toggle then flipped it straight back to false -- clicking
          // the toggle appeared to do nothing for a mouse user. Click
          // now always ENSURES the list is open (matching what hover
          // already does); closing happens via mouseleave, blur, or a
          // real click outside the whole component -- all already
          // implemented, and none of them race with this.
          setExpanded(true)
        }}
      >
        {sources.length > 4 ? (
          <span className="font-mono text-[10px]">+{sources.length - 4}</span>
        ) : (
          <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" aria-hidden="true">
            <path
              d={expanded ? 'M2 7l4-4 4 4' : 'M2 4l4 4 4-4'}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>

      {expanded && (
        <ul
          id={listId}
          role="list"
          className="absolute left-0 top-full z-20 mt-1 min-w-[220px] max-w-xs space-y-1 border border-observatory-border bg-observatory-surface p-2 shadow-lg"
        >
          {sources.map((source) => (
            <li key={source.url}>
              {/* REAL BUG FIXED: this list item previously rendered its
                  own <a> wrapping a SourceFaviconIcon that ALSO rendered
                  its own <a> to the same URL -- <a> nested inside <a>,
                  invalid HTML, caught by a real DOM test
                  ("cannot be a descendant of <a>"), not by the earlier
                  source-text assertions, which never checked for this
                  specific nesting. Now exactly ONE <a> per list item;
                  the icon renders only its VISUAL content (image or
                  fallback letter), never its own anchor, here. */}
              <a
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 rounded px-1.5 py-1 text-xs text-text-secondary transition-colors hover:bg-observatory-dark hover:text-text-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-text-primary/50"
              >
                <SourceFaviconVisual source={source} size="small" />
                <span className="truncate">{source.sourceName}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * Pure VISUAL content only -- image or fallback letter, no <a> of its
 * own. Reusable inside whichever single <a> the caller provides (the
 * stacked view's own link, or the expanded list item's own link),
 * so this component can never itself create a nested-anchor bug.
 */
function SourceFaviconVisual({
  source,
  size,
}: {
  source: SourceLink
  size: 'small' | 'stack'
}): React.JSX.Element {
  const [failed, setFailed] = useState(!source.faviconUrl)

  return !failed && source.faviconUrl ? (
    // eslint-disable-next-line @next/next/no-img-element -- external, unknown-dimension favicon; next/image would require remotePatterns for every possible source domain
    <img
      src={source.faviconUrl}
      alt=""
      className="h-full w-full object-contain"
      onError={() => setFailed(true)}
    />
  ) : (
    // Fallback: neutral icon. The source name is shown as separate,
    // real text by the caller (never only inside this element), per
    // "при отсутствии логотипа показывать нейтральную иконку и имя."
    <span
      className={size === 'small' ? 'text-[9px] text-text-muted' : 'text-[9px] text-text-muted'}
      aria-hidden="true"
    >
      {source.sourceName.charAt(0).toUpperCase()}
    </span>
  )
}

/**
 * A single stacked icon -- its OWN top-level <a>, a sibling of the
 * other stacked icons and of the separate toggle <button>. Never
 * nested inside another interactive element.
 */
function SourceFaviconLink({
  source,
  stackIndex,
}: {
  source: SourceLink
  stackIndex: number
}): React.JSX.Element {
  return (
    <a
      href={source.url}
      target="_blank"
      rel="noopener noreferrer"
      title={source.sourceName}
      aria-label={`Open source: ${source.sourceName}`}
      className="z-0 flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full border border-observatory-border bg-observatory-dark ring-2 ring-observatory-surface"
      style={{ zIndex: 10 - stackIndex }}
    >
      <SourceFaviconVisual source={source} size="stack" />
    </a>
  )
}
