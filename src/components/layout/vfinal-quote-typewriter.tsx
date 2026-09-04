'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * AIscentra — hero quote, typewriter-effect version.
 *
 * Real, owner-provided HTML mockup adapted into a React client
 * component, then further corrected against 5 real, specific owner-
 * reported bugs after the first live preview review (2026-09-03):
 *
 * 1. Quotation marks are now part of the animated TEXT itself
 *    (typed in, erased out with everything else) -- an earlier
 *    version rendered the opening mark as static, always-present
 *    JSX outside the animated string, which left a real, visible
 *    stray `"` behind after a full erase cycle finished.
 * 2. Font size reduced to match this site's own real header/nav text
 *    size (no special utility class on those nav links -- their real,
 *    actual size is the browser/Tailwind default `text-base`, 16px).
 *    An earlier version used a much larger text-2xl/3xl size, which
 *    was too large relative to the header, as reported.
 * 3. The left vertical rule (blockquote border) is removed entirely,
 *    per direct owner instruction -- an earlier version kept it as a
 *    holdover from the original static (non-animated) quote design.
 * 4. The blinking cursor now stays visible and blinking continuously
 *    from the moment typing starts all the way through the full
 *    "reading" pause and the entire erase phase -- it only goes fully
 *    dark during the true rest gap between cycles. An earlier version
 *    (matching the original mockup's own literal behavior) turned the
 *    cursor off immediately once typing finished, which read as the
 *    cursor "disappearing" right when the owner wanted it to keep
 *    blinking, exactly as reported.
 *
 * What's unchanged from the original adaptation, still real and still
 * correct:
 * - Colors: this project's own real theme variables
 *   (--color-mint-signal for the cursor/accent, --color-silver-haze
 *   for body text), never the mockup's own placeholder orange/red.
 * - No prefers-reduced-motion gating, matching this exact codebase's
 *   own already-established real decision (see vfinal-interaction-
 *   controller.tsx's own comments).
 * - Real timer cleanup (clearInterval/clearTimeout tracked and
 *   cleared on unmount) to avoid a real state-update-after-unmount
 *   leak.
 */

const QUOTE_TEXT =
  '\u201cWe don\u2019t predict the future. We measure the present. No forecast can promise what reality will do next \u2014 only how honestly it was made, and how often it holds up. The decision, and its consequences, remain yours.\u201d'

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
          // Real fix (#4): cursor stays on -- do NOT turn it off here.
          // It keeps blinking through the reading pause and the erase
          // phase below, only going dark during the true rest gap.
          onDone()
        }
      }, TYPE_DELAY_MS)
      timers.push(timer)
    }

    function eraseOut(onDone: () => void): void {
      setSignatureShown(false)
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
      <p className="min-h-[4.8em] text-base italic leading-relaxed text-silver-haze md:min-h-[2.4em]">
        {visibleText}
        <span
          aria-hidden="true"
          className={`ml-0.5 inline-block h-[1em] w-[2px] translate-y-[0.15em] bg-mint-signal ${
            cursorOn ? 'animate-pulse opacity-100' : 'opacity-0'
          }`}
        />
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
