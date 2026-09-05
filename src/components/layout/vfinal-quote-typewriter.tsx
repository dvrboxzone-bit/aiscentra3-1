'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * AIscentra — hero quote, typewriter-effect version.
 *
 * Real, owner-provided HTML mockup adapted into a React client
 * component, corrected against real, specific owner-reported bugs
 * after live preview reviews (2026-09-03), most recently a second
 * real mockup replacing this component's typing LOGIC only (explicit
 * owner instruction: "только эти 2 изменения" -- human-like typing
 * pace, and a single simulated typo-then-correction beat; everything
 * else -- site fonts/colors, no border, always-blinking cursor --
 * stays as already fixed).
 *
 * What changed in this round (real typing-logic replacement, from the
 * owner's own second mockup):
 * - Per-character delay is no longer a fixed interval. It now follows
 *   the mockup's own real formula: a 30-70ms random base, plus a rare
 *   (~6% chance per character) extra 120-300ms "hesitation" pause --
 *   producing a genuinely human, uneven typing rhythm rather than a
 *   metronomic one.
 * - A single, real simulated mistake: while typing, the component
 *   reaches the real em dash in "next — only" and, exactly like a
 *   distracted human, types past it without the dash first ("next
 *   only" instead of "next — only"), pauses briefly as if noticing,
 *   backspaces the wrong continuation out, pauses again, then retypes
 *   the correct "— only" before continuing normally. The exact anchor
 *   position and both the "correct" and "wrong" substrings are
 *   computed here via a real `indexOf` on this file's own actual
 *   QUOTE_TEXT (confirmed via a live Node check before writing this
 *   code -- position 103, matching exactly " \u2014 only how") rather
 *   than reusing the second mockup's own hardcoded character offsets,
 *   which were computed against ITS OWN copy of the quote and are not
 *   guaranteed to line up with this file's real string.
 *
 * What's unchanged, still real and still correct from earlier rounds:
 * - Colors: this project's own real theme variables
 *   (--color-mint-signal for the cursor/accent, --color-silver-haze
 *   for body text), never the mockup's own placeholder orange/red
 *   accent or its corner-border decoration (removed per direct owner
 *   instruction in an earlier round).
 * - Quotation marks are part of the animated TEXT itself, so they
 *   type in and erase out with everything else -- no stray leftover
 *   character after a full erase.
 * - Font size matches this site's own real header/nav text size
 *   (`text-base`, 16px).
 * - The cursor blinks permanently and continuously -- no on/off state
 *   at all -- matching the owner's own explicit "always."
 * - `translate="no"` / `notranslate` on both the wrapper and the
 *   actively-mutating text element, a real, standard mitigation for a
 *   real, owner-reported page crash under browser auto-translate
 *   (translation extensions wrap text nodes in `<font>` tags; this
 *   component rewriting that same text many times per second could
 *   otherwise throw a real DOM exception when the two disagree about
 *   the DOM's own shape).
 * - Reserved `min-height` sized from real, live-measured line counts
 *   at 5 real viewport widths so the block never visibly grows while
 *   typing.
 * - No prefers-reduced-motion gating, matching this exact codebase's
 *   own already-established real decision (see vfinal-interaction-
 *   controller.tsx's own comments).
 * - Real timer cleanup (a `cancelled` flag checked after every
 *   scheduled step) to avoid a real state-update-after-unmount leak.
 */

const QUOTE_TEXT =
  '\u201cWe don\u2019t predict the future. We measure the present. No forecast can promise what reality will do next \u2014 only how honestly it was made, and how often it holds up. The decision, and its consequences, remain yours.\u201d'

// Real anchor for the simulated typo: the exact " — only how" span in
// the real QUOTE_TEXT above (confirmed via a live check: index 103).
const CORRECT_SPAN = ' \u2014 only how'
const WRONG_SPAN = ' only how'
const MISTAKE_INDEX = QUOTE_TEXT.indexOf(CORRECT_SPAN)
const TEXT_BEFORE_MISTAKE = QUOTE_TEXT.slice(0, MISTAKE_INDEX)
const TEXT_AFTER_MISTAKE = QUOTE_TEXT.slice(MISTAKE_INDEX + CORRECT_SPAN.length)

const READ_PAUSE_MS = 9000
const CYCLE_REST_MS = 6000

function humanTypeDelay(): number {
  const base = 30 + Math.random() * 40
  const hesitation = Math.random() < 0.06 ? 120 + Math.random() * 180 : 0
  return base + hesitation
}

function eraseDelay(): number {
  return 12 + Math.random() * 14
}

export function VfinalQuoteTypewriter(): React.JSX.Element {
  const [visibleText, setVisibleText] = useState('')
  const [signatureShown, setSignatureShown] = useState(false)
  const cancelledRef = useRef(false)
  const timersRef = useRef<Array<ReturnType<typeof setTimeout>>>([])

  useEffect(() => {
    cancelledRef.current = false
    const timers = timersRef.current

    function wait(ms: number): Promise<void> {
      return new Promise((resolve) => {
        const t = setTimeout(resolve, ms)
        timers.push(t)
      })
    }

    async function typeChars(str: string, startingFrom: string): Promise<string> {
      let shown = startingFrom
      for (let i = 0; i < str.length; i++) {
        if (cancelledRef.current) return shown
        shown += str[i]
        setVisibleText(shown)
        await wait(humanTypeDelay())
      }
      return shown
    }

    async function backspace(startingFrom: string, count: number): Promise<string> {
      let shown = startingFrom
      for (let i = 0; i < count; i++) {
        if (cancelledRef.current) return shown
        shown = shown.slice(0, -1)
        setVisibleText(shown)
        await wait(eraseDelay())
      }
      return shown
    }

    async function typeOut(): Promise<void> {
      let shown = await typeChars(TEXT_BEFORE_MISTAKE, '')
      if (cancelledRef.current) return
      // The real, simulated mistake: type past the dash without it.
      shown = await typeChars(WRONG_SPAN, shown)
      if (cancelledRef.current) return
      await wait(650 + Math.random() * 350)
      if (cancelledRef.current) return
      shown = await backspace(shown, WRONG_SPAN.length)
      if (cancelledRef.current) return
      await wait(220)
      if (cancelledRef.current) return
      shown = await typeChars(CORRECT_SPAN, shown)
      if (cancelledRef.current) return
      await typeChars(TEXT_AFTER_MISTAKE, shown)
    }

    async function eraseOut(): Promise<void> {
      setSignatureShown(false)
      let shown = QUOTE_TEXT
      while (shown.length > 0) {
        if (cancelledRef.current) return
        shown = shown.slice(0, -1)
        setVisibleText(shown)
        await wait(eraseDelay())
      }
    }

    async function cycle(): Promise<void> {
      if (cancelledRef.current) return
      await typeOut()
      if (cancelledRef.current) return
      const showSig = setTimeout(() => {
        if (!cancelledRef.current) setSignatureShown(true)
      }, 300)
      timers.push(showSig)
      await wait(READ_PAUSE_MS)
      if (cancelledRef.current) return
      await eraseOut()
      if (cancelledRef.current) return
      await wait(CYCLE_REST_MS)
      if (cancelledRef.current) return
      await cycle()
    }

    const startDelay = setTimeout(() => {
      void cycle()
    }, 600)
    timers.push(startDelay)

    return () => {
      cancelledRef.current = true
      timers.forEach((t) => clearTimeout(t))
      timers.length = 0
    }
  }, [])

  return (
    <div translate="no" className="notranslate">
      <p
        translate="no"
        className="notranslate min-h-[9.6em] text-base italic leading-relaxed text-silver-haze md:min-h-[4.8em]"
      >
        {visibleText}
        <span
          aria-hidden="true"
          className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[0.15em] animate-pulse bg-mint-signal opacity-100"
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
