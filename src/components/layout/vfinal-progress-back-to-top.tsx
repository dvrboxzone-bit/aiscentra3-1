'use client'

import { useEffect, useRef } from 'react'
import { getActiveLenisInstance } from './vfinal-lenis-provider'

/**
 * AIscentra — vfinal scroll progress bar + back-to-top button (layer 3)
 *
 * Ported from AIscentra-vfinal-adapt.html's own inline script: a single
 * shared `scroll` listener updates both #progress's width and
 * #back-to-top's `.visible` class (>300px scrolled), matching the
 * HTML's own combined logic exactly rather than splitting it into two
 * independent listeners. Its own click handler matches the HTML's own
 * exact branch: `if (lenis) lenis.scrollTo(0); else
 * window.scrollTo({top:0, behavior:'smooth'})` -- via
 * getActiveLenisInstance() (see vfinal-lenis-provider.tsx), not a
 * plain, unconditional window.scrollTo() guess.
 *
 * SSR-safe: 'use client', DOM refs instead of getElementById, full
 * removeEventListener cleanup on unmount.
 */
export function VfinalProgressAndBackToTop(): React.JSX.Element {
  const progressRef = useRef<HTMLDivElement>(null)
  const backToTopRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const onScroll = (): void => {
      const h = document.documentElement
      const denom = h.scrollHeight - h.clientHeight
      const pct = denom > 0 ? (h.scrollTop / denom) * 100 : 0
      if (progressRef.current) progressRef.current.style.width = `${pct}%`
      if (backToTopRef.current) {
        if (h.scrollTop > 300) backToTopRef.current.classList.add('visible')
        else backToTopRef.current.classList.remove('visible')
      }
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const handleBackToTop = (): void => {
    const lenis = getActiveLenisInstance()
    if (lenis) lenis.scrollTo(0)
    else window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <>
      <div id="progress" ref={progressRef} />
      <button
        id="back-to-top"
        ref={backToTopRef}
        aria-label="Back to top"
        onClick={handleBackToTop}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
        </svg>
      </button>
    </>
  )
}
