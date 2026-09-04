'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * AIscentra — hero quote, typewriter-effect version.
 *
 * Real, owner-provided HTML mockup adapted into a React client
 * component. What changed from the mockup and why:
 * - Colors: the mockup used its own placeholder palette
 *   (--bg: #0A0A0A, --accent: #C1442C, an orange/red never used
 *   anywhere else on this site). Replaced with this project's own
 *   real theme variables (--color-mint-signal for the cursor/accent,
 *   --color-silver-haze for body text) -- never introduce a new,
 *   one-off color outside the established palette.
 * - No prefers-reduced-motion gating: matches this exact codebase's
 *   own established, real decision (see vfinal-interaction-
 *   controller.tsx's own comments) not to gate decorative animation
 *   on that media query, because headless/automated test browsers
 *   default it to "reduce," which was previously disabling effects
 *   for real users too, not just correctly respecting an explicit
 *   real user preference.
 * - Typing/erasing timers implemented with real cleanup
 *   (clearInterval/clearTimeout on unmount) to avoid a real memory
 *   leak / state update after unmount if the user navigates away
 *   mid-animation.
 * - Real curly typographic quotation marks and the exact quote text
 *   already approved for this page are preserved unchanged.
 */

const QUOTE_TEXT =
  'We don\u2019t predict the future. We measure the present. No forecast can promise what reality will do next \u2014 only how honestly it was made, and how often it holds up. The decision, and its consequences, remain yours.'

const TYPE_DELAY_MS = 34
const ERASE_DELAY_MS = 14
const READ_PAUSE_MS = 9000
const CYCLE_REST_MS = 6000

export function VfinalQuoteTypewriter(): React.JSX.Element {
  const [visibleText, setVisibleText] = useState('')
  const [cursorOn, setCursorOn] = useState(false)
  const [signatureShown, setSignatureShown] = useState(false)
  const timersRef = useRef<Array<ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>>>(
    [],
  )

  useEffect(() => {
    let cancelled = false
    const timers = timersRef.current

    function typeOut(onDone: () => void): void {
      setCursorOn(true)
      let i = 0
      const timer = setInterval(() => {
        if (cancelled) return
        i++
        setVisibleText(QUOTE_TEXT.slice(0, i))
        if (i >= QUOTE_TEXT.length) {
          clearInterval(timer)
          setCursorOn(false)
          onDone()
        }
      }, TYPE_DELAY_MS)
      timers.push(timer)
    }

    function eraseOut(onDone: () => void): void {
      setSignatureShown(false)
      setCursorOn(true)
      let i = QUOTE_TEXT.length
      const timer = setInterval(() => {
        if (cancelled) return
        i--
        setVisibleText(QUOTE_TEXT.slice(0, Math.max(0, i)))
        if (i <= 0) {
          clearInterval(timer)
          setCursorOn(false)
          onDone()
        }
      }, ERASE_DELAY_MS)
      timers.push(timer)
    }

    function cycle(): void {
      if (cancelled) return
      typeOut(() => {
        const showSig = setTimeout(() => {
          if (!cancelled) setSignatureShown(true)
        }, 300)
        timers.push(showSig)
        const startErase = setTimeout(() => {
          eraseOut(() => {
            const rest = setTimeout(cycle, CYCLE_REST_MS)
            timers.push(rest)
          })
        }, READ_PAUSE_MS)
        timers.push(startErase)
      })
    }

    const startDelay = setTimeout(cycle, 600)
    timers.push(startDelay)

    return () => {
      cancelled = true
      timers.forEach((t) => {
        clearInterval(t)
        clearTimeout(t)
      })
    }
  }, [])

  return (
    <div>
      <p className="min-h-[6.4em] text-2xl italic leading-relaxed text-silver-haze md:min-h-[3.2em] md:text-3xl">
        &ldquo;{visibleText}
        <span
          aria-hidden="true"
          className={`ml-0.5 inline-block h-[1em] w-[2px] translate-y-[0.15em] bg-mint-signal ${
            cursorOn ? 'animate-pulse opacity-100' : 'opacity-0'
          }`}
        />
        {visibleText.length >= QUOTE_TEXT.length ? '\u201d' : ''}
      </p>
      <footer
        className={`mt-4 text-sm not-italic text-mint-signal transition-opacity duration-700 ${
          signatureShown ? 'opacity-100' : 'opacity-0'
        }`}
      >
        AIscentra · I.O
      </footer>
    </div>
  )
}
