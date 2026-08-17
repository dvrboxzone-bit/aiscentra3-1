'use client'

import { useEffect } from 'react'

/**
 * AIscentra — vfinal magnetic-hover + reveal-on-scroll controller
 * (Public Interactivity Correction checkpoint)
 *
 * REAL BUG FIXED (confirmed defect #1): `.magnetic`/`.reveal` classes
 * are present throughout the server-rendered markup, but the two
 * per-element hooks that used to implement this behavior
 * (useVfinalMagnetic/useVfinalReveal) were never actually called by any
 * component -- every `.magnetic` element never received a mousemove
 * transform, and every `.reveal` element never received the `.in`
 * class that reveals it, leaving reveal content permanently invisible
 * outside prefers-reduced-motion. Those two dead hooks are removed;
 * this single controller replaces them, mounted once in
 * VfinalPublicShell (matching the HTML source's own single top-level
 * `document.querySelectorAll('.magnetic'/'.reveal')` init) so no
 * server page has to call a client hook itself.
 *
 * Handles content that exists at mount time AND content that appears
 * later (streamed Suspense boundaries, client-rendered state changes)
 * via a MutationObserver watching the whole document for added nodes.
 * Each element is bound at most once (a WeakSet for magnetic elements,
 * a `data-reveal-bound` marker for reveal elements, mirroring the
 * reveal IntersectionObserver's own one-shot per-element contract) so
 * re-scanning a subtree already handled by an earlier pass, or a
 * mutation batch overlapping a previous one, never attaches a second
 * pair of listeners to the same element.
 *
 * Because this controller (like VfinalLenisProvider and
 * VfinalProgressAndBackToTop before it) is mounted inside
 * VfinalPublicShell -- rendered per-page, not in the root layout --
 * App Router navigation unmounts the old page's shell and mounts the
 * new one, so this effect's own cleanup (disconnect both observers,
 * remove every attached listener) already runs on every navigation and
 * a fresh scan runs for the new page. No listener/observer survives
 * past this component's own unmount.
 *
 * prefers-reduced-motion: magnetic elements are left untouched (no
 * transform is ever applied) so nothing moves under mouse input;
 * reveal elements are still observed and still get `.in` added on
 * intersection, but globals.css's own reduced-motion override
 * (`.reveal { opacity:1; transform:none; transition:none }`) already
 * makes that a no-op visually -- consistent with the original hooks'
 * own division of responsibility (JS only toggles a class, the actual
 * animation/no-animation behavior lives in CSS).
 */
const MAGNETIC_SELECTOR = '.magnetic'
const REVEAL_SELECTOR = '.reveal'
const MAGNETIC_FACTOR = 0.25
const REVEAL_THRESHOLD = 0.15
const REVEAL_BOUND_ATTR = 'data-reveal-bound'

export function VfinalInteractionController(): null {
  useEffect(() => {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const magneticCleanups = new WeakMap<Element, () => void>()

    const revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('in')
            revealObserver.unobserve(entry.target)
          }
        })
      },
      { threshold: REVEAL_THRESHOLD },
    )

    function bindMagnetic(el: Element): void {
      if (prefersReducedMotion) return
      if (magneticCleanups.has(el)) return
      const node = el as HTMLElement

      const onMouseMove = (e: MouseEvent): void => {
        const rect = node.getBoundingClientRect()
        const x = e.clientX - rect.left - rect.width / 2
        const y = e.clientY - rect.top - rect.height / 2
        node.style.transform = `translate(${x * MAGNETIC_FACTOR}px, ${y * MAGNETIC_FACTOR}px)`
      }
      const onMouseLeave = (): void => {
        node.style.transform = 'translate(0, 0)'
      }

      node.addEventListener('mousemove', onMouseMove)
      node.addEventListener('mouseleave', onMouseLeave)
      magneticCleanups.set(el, () => {
        node.removeEventListener('mousemove', onMouseMove)
        node.removeEventListener('mouseleave', onMouseLeave)
      })
    }

    function bindReveal(el: Element): void {
      if (el.hasAttribute(REVEAL_BOUND_ATTR)) return
      el.setAttribute(REVEAL_BOUND_ATTR, 'true')
      revealObserver.observe(el)
    }

    function scan(root: ParentNode): void {
      root.querySelectorAll(MAGNETIC_SELECTOR).forEach(bindMagnetic)
      root.querySelectorAll(REVEAL_SELECTOR).forEach(bindReveal)
    }

    scan(document)

    const mutationObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (!(node instanceof Element)) return
          if (node.matches(MAGNETIC_SELECTOR)) bindMagnetic(node)
          if (node.matches(REVEAL_SELECTOR)) bindReveal(node)
          scan(node)
        })
      }
    })
    mutationObserver.observe(document.body, { childList: true, subtree: true })

    return () => {
      mutationObserver.disconnect()
      revealObserver.disconnect()
      document.querySelectorAll(MAGNETIC_SELECTOR).forEach((el) => {
        magneticCleanups.get(el)?.()
      })
      document.querySelectorAll(`[${REVEAL_BOUND_ATTR}]`).forEach((el) => {
        el.removeAttribute(REVEAL_BOUND_ATTR)
      })
    }
  }, [])

  return null
}
