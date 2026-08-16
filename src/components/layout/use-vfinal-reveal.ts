'use client'

import { useEffect, useRef } from 'react'

/**
 * AIscentra — vfinal reveal-on-scroll hook (layer 3)
 *
 * Ported from AIscentra-vfinal-adapt.html's own reveal IntersectionObserver
 * (threshold 0.15, `.reveal` class initial state + `.in` class added
 * once intersecting, `io.unobserve(el)` immediately after -- a one-shot
 * reveal per element, exactly matching the HTML's own behavior).
 *
 * The HTML observes `.reveal` elements GLOBALLY (querySelectorAll over
 * the whole document, once, on page load). This hook instead scopes
 * observation to ONE element per call (a real React/Next.js pattern:
 * every component that wants reveal behavior calls this hook itself on
 * its own ref) -- functionally equivalent (each element still reveals
 * itself independently, same threshold, same one-shot unobserve
 * behavior), but composable across React's own component tree instead
 * of a single global document-wide query that would need to re-run on
 * every client-side navigation.
 *
 * globals.css's own `.reveal`/`.reveal.in` CSS (opacity/transform
 * transition, plus the prefers-reduced-motion override added in layer
 * 1) is unchanged -- this hook only toggles the class, the animation
 * behavior itself lives entirely in CSS as in the original.
 */
export function useVfinalReveal<
  T extends HTMLElement = HTMLDivElement,
>(): React.RefObject<T | null> {
  const ref = useRef<T>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('in')
            io.unobserve(entry.target)
          }
        })
      },
      { threshold: 0.15 },
    )
    io.observe(el)

    return () => io.disconnect()
  }, [])

  return ref
}
