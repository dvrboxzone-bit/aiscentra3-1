'use client'

import { useEffect } from 'react'
import Lenis from 'lenis'

/**
 * AIscentra — vfinal Lenis smooth-scroll provider (layer 3)
 *
 * Ported from AIscentra-vfinal-adapt.html's own inline Lenis init
 * (duration 1.2, the exact custom easing function, smoothWheel: true).
 * Uses the real npm `lenis` package (1.3.26, the maintained successor
 * to @studio-freight/lenis which the HTML's own CDN URL references --
 * same author, darkroom.engineering, confirmed via package.json)
 * rather than the HTML's own CDN <script>.
 *
 * SSR-safe: 'use client', all work inside useEffect. Full cleanup on
 * unmount (lenis.destroy(), cancelAnimationFrame) so client-side
 * navigation away from and back to a page using this provider never
 * creates a second, competing raf loop.
 *
 * prefers-reduced-motion: Lenis is not initialized at all when the
 * user has requested reduced motion -- the browser's own native
 * (instant) scrolling is used instead. Not present in the original
 * HTML; added per this task's own explicit technical-boundaries
 * requirement.
 *
 * The active Lenis instance is exposed via getActiveLenisInstance()
 * below (module-level reference, matching the HTML's own single
 * top-level `let lenis;` variable) so VfinalProgressAndBackToTop's own
 * back-to-top button can call the REAL lenis.scrollTo(0) -- not a
 * plain window.scrollTo() guess -- exactly matching the HTML's own
 * `if (lenis) lenis.scrollTo(0); else window.scrollTo(...)` branch.
 */
let activeLenisInstance: Lenis | null = null

export function getActiveLenisInstance(): Lenis | null {
  return activeLenisInstance
}

export function VfinalLenisProvider(): null {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const lenis = new Lenis({
      duration: 1.2,
      easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
    })
    activeLenisInstance = lenis

    let rafId = 0
    function raf(time: number): void {
      lenis.raf(time)
      rafId = requestAnimationFrame(raf)
    }
    rafId = requestAnimationFrame(raf)

    return () => {
      cancelAnimationFrame(rafId)
      lenis.destroy()
      activeLenisInstance = null
    }
  }, [])

  return null
}
