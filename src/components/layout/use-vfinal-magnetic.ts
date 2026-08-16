'use client'

import { useEffect, useRef } from 'react'

/**
 * AIscentra — vfinal magnetic-hover hook (layer 3)
 *
 * Ported from AIscentra-vfinal-adapt.html's own `.magnetic` mousemove/
 * mouseleave handlers -- exact same 0.25 subtle-movement factor and
 * reset-to-(0,0) on mouseleave. globals.css's own `.magnetic`
 * transition/will-change CSS (layer 1) provides the smooth easing back
 * to origin; this hook only sets the raw transform, same division of
 * responsibility as the original inline <script>.
 *
 * Per-element hook (one call per magnetic element), same composability
 * rationale as useVfinalReveal.
 */
export function useVfinalMagnetic<
  T extends HTMLElement = HTMLElement,
>(): React.RefObject<T | null> {
  const ref = useRef<T>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const onMouseMove = (e: MouseEvent): void => {
      const rect = el.getBoundingClientRect()
      const x = e.clientX - rect.left - rect.width / 2
      const y = e.clientY - rect.top - rect.height / 2
      el.style.transform = `translate(${x * 0.25}px, ${y * 0.25}px)`
    }
    const onMouseLeave = (): void => {
      el.style.transform = 'translate(0, 0)'
    }

    el.addEventListener('mousemove', onMouseMove)
    el.addEventListener('mouseleave', onMouseLeave)

    return () => {
      el.removeEventListener('mousemove', onMouseMove)
      el.removeEventListener('mouseleave', onMouseLeave)
    }
  }, [])

  return ref
}
