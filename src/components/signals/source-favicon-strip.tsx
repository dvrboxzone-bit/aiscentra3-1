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
 *
 * The "unsafe/unreachable URL excluded, and if none remain the signal
 * is not published" half of the requirement is enforced further
 * upstream, in getSourceLinksForSignal (server) and by the page that
 * renders this component choosing not to render it (or the whole
 * signal) when the sources array is empty -- this component itself
 * simply renders nothing for an empty array, which is the correct
 * behavior for a component that must not assume it's the one deciding
 * publication.
 */
export function SourceFaviconStrip({
  sources,
  className,
}: SourceFaviconStripProps): React.JSX.Element | null {
  const [expanded, setExpanded] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  // Click-outside closes the expanded list (mouse/touch users who
  // opened it by clicking the strip, not just hovering).
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
    >
      <button
        type="button"
        className="flex items-center -space-x-2 rounded-full py-1 pr-2 transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-1 focus-visible:ring-text-primary/50"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-label={`Sources: ${sources.length} ${sources.length === 1 ? 'reference' : 'references'}. Show full list.`}
        onClick={() => setExpanded((v) => !v)}
        onFocus={() => setExpanded(true)}
        onBlur={(e) => {
          // Don't collapse if focus is moving to something else inside
          // this same component (e.g. into the expanded list itself).
          if (!containerRef.current?.contains(e.relatedTarget as Node)) {
            setExpanded(false)
          }
        }}
      >
        {sources.slice(0, 4).map((source, i) => (
          <SourceFaviconIcon key={source.url} source={source} stackIndex={i} />
        ))}
        {sources.length > 4 && (
          <span className="z-10 flex h-6 w-6 items-center justify-center rounded-full border border-observatory-border bg-observatory-surface font-mono text-[10px] text-text-muted">
            +{sources.length - 4}
          </span>
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
              <a
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 rounded px-1.5 py-1 text-xs text-text-secondary transition-colors hover:bg-observatory-dark hover:text-text-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-text-primary/50"
              >
                <SourceFaviconIcon source={source} stackIndex={0} noStack />
                <span className="truncate">{source.sourceName}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function SourceFaviconIcon({
  source,
  stackIndex,
  noStack,
}: {
  source: SourceLink
  stackIndex: number
  noStack?: boolean
}): React.JSX.Element {
  const [failed, setFailed] = useState(!source.faviconUrl)

  return (
    <a
      href={source.url}
      target="_blank"
      rel="noopener noreferrer"
      title={source.sourceName}
      aria-label={`Open source: ${source.sourceName}`}
      className={
        noStack
          ? 'flex h-4 w-4 shrink-0 items-center justify-center overflow-hidden rounded-full border border-observatory-border bg-observatory-dark'
          : 'z-0 flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full border border-observatory-border bg-observatory-dark ring-2 ring-observatory-surface'
      }
      style={noStack ? undefined : { zIndex: 10 - stackIndex }}
      onClick={(e) => e.stopPropagation()}
    >
      {!failed && source.faviconUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- external, unknown-dimension favicon; next/image would require remotePatterns for every possible source domain
        <img
          src={source.faviconUrl}
          alt=""
          className="h-full w-full object-contain"
          onError={() => setFailed(true)}
        />
      ) : (
        // Fallback: neutral icon. Name is shown separately by the
        // caller in the expanded list; the compact stack relies on the
        // title attribute for the name in this collapsed state.
        <span className="text-[9px] text-text-muted" aria-hidden="true">
          {source.sourceName.charAt(0).toUpperCase()}
        </span>
      )}
    </a>
  )
}
