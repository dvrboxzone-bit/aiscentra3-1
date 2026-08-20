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
 * REAL BUG FIXED (Preview correction, root-cause pass against the
 * original AIscentra-vfinal-adapt.html reference): a prefers-reduced-
 * motion early-return here previously skipped Lenis init entirely --
 * not present in the reference HTML's own inline init (it always
 * constructs Lenis, unconditionally). Removed to match the reference:
 * Lenis always initializes.
 *
 * REAL BUG FIXED (second, deeper cause of the same symptom -- "no
 * smoothing/inertia" persisted even after removing the early-return
 * above): the `lenis` npm package's own `LenisOptions` type
 * (node_modules/lenis/dist/lenis.d.ts) documents `respectReducedMotion`
 * as defaulting to `true` -- an INTERNAL default the library applies
 * regardless of anything this file does: "smoothing is disabled (lerp
 * forced to 1 so scroll tracks the input device 1:1)" whenever the
 * browser reports prefers-reduced-motion:reduce. The old CDN version
 * the reference HTML actually uses (@studio-freight/lenis@1.0.42,
 * confirmed via its own <script src> URL) predates this option
 * entirely, so the reference's own real, observed behavior is
 * unconditionally smooth regardless of OS/browser motion settings.
 * `respectReducedMotion: false` is passed explicitly to match that.
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
    const lenis = new Lenis({
      duration: 1.2,
      easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      respectReducedMotion: false,
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
