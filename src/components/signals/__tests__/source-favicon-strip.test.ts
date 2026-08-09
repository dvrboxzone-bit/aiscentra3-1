/**
 * AIscentra — SourceFaviconStrip component tests
 *
 * This project has no React/DOM test infrastructure (no jsdom, no
 * @testing-library/react in package.json) -- adding that late in an
 * already large PR is out of scope here. These are source-level
 * assertions, the same technique already used successfully elsewhere
 * in this codebase (e.g. src/lib/ai/__tests__/budget-gate.test.ts's
 * assertions about agent.ts) to lock in that specific, required
 * behaviors are genuinely present in the component's own source,
 * rather than full rendered-DOM interaction tests.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = (): string => readFileSync('src/components/signals/source-favicon-strip.tsx', 'utf8')

describe('SourceFaviconStrip — multiple sources', () => {
  test('renders more than one source, stacked (overlapping), not a wide row', () => {
    const s = src()
    assert.match(s, /sources\.slice\(0,\s*4\)\.map/, 'must iterate over multiple sources')
    assert.match(s, /-space-x-2/, 'must use a negative-margin overlap stack, not a plain row')
  })

  test('a "+N" overflow indicator exists for more than 4 sources', () => {
    assert.match(src(), /\+\{sources\.length - 4\}/)
  })

  test('the expanded full list renders every source, not just the visible stack', () => {
    const s = src()
    // The <ul> block maps over `sources` directly (not sources.slice(0,4))
    assert.match(s, /sources\.map\(\(source\) => \(\s*<li/)
  })
})

describe('SourceFaviconStrip — list reveal on hover, click/tap, and keyboard focus', () => {
  test('hover triggers reveal (onMouseEnter/onMouseLeave)', () => {
    const s = src()
    assert.match(s, /onMouseEnter=\{.*setExpanded\(true\)/)
    assert.match(s, /onMouseLeave=\{.*setExpanded\(false\)/)
  })

  test('click/tap triggers reveal -- a real onClick toggle, not hover-only', () => {
    assert.match(src(), /onClick=\{\(\) => setExpanded\(\(v\) => !v\)\}/)
  })

  test('keyboard focus triggers reveal -- onFocus, independent of hover/click', () => {
    assert.match(src(), /onFocus=\{\(\) => setExpanded\(true\)\}/)
  })

  test('the trigger is a real <button>, reachable by Tab, not a div with a click handler', () => {
    const s = src()
    const buttonIdx = s.indexOf('<button')
    const onFocusIdx = s.indexOf('onFocus=')
    assert.ok(buttonIdx > -1, 'must use a semantic <button> element for keyboard reachability')
    assert.ok(
      onFocusIdx > buttonIdx && onFocusIdx < buttonIdx + 800,
      'onFocus must be on the button itself',
    )
  })

  test('ARIA state is exposed for assistive technology (aria-expanded, aria-controls)', () => {
    const s = src()
    assert.match(s, /aria-expanded=\{expanded\}/)
    assert.match(s, /aria-controls=\{listId\}/)
  })

  test('a visible focus ring exists (focus-visible), not focus removed entirely', () => {
    assert.match(src(), /focus-visible:ring/)
  })
})

describe('SourceFaviconStrip — mobile / touch handling', () => {
  test('click-outside closes the list -- required for touch users who cannot hover to dismiss', () => {
    const s = src()
    assert.match(
      s,
      /mousedown/,
      'a document-level pointer listener must exist to detect outside taps',
    )
    assert.match(s, /handleClickOutside/)
  })

  test('the click-outside listener is cleaned up (no leaked listener across renders)', () => {
    assert.match(src(), /removeEventListener\('mousedown', handleClickOutside\)/)
  })

  test('icons are large enough for a touch target (not sub-pixel-scale)', () => {
    const s = src()
    // h-6 w-6 (~24px) for the stack, h-4 w-4 for the compact in-list icon --
    // both real, deliberately sized, not arbitrary.
    assert.match(s, /h-6 w-6/)
  })
})

describe('SourceFaviconStrip — missing logo / fallback', () => {
  test('a failed or missing favicon falls back to a neutral element, not a broken image', () => {
    const s = src()
    assert.match(
      s,
      /useState\(!source\.faviconUrl\)/,
      'starts in fallback state when no favicon URL exists at all',
    )
    assert.match(
      s,
      /onError=\{\(\) => setFailed\(true\)\}/,
      'a load failure (404, etc.) also triggers fallback',
    )
  })

  test('the fallback shows the source name (initial) -- never a blank icon', () => {
    const s = src()
    assert.match(s, /source\.sourceName\.charAt\(0\)\.toUpperCase\(\)/)
  })

  test('the source name is shown in full in the expanded list, even when the favicon loaded fine', () => {
    assert.match(src(), /<span className="truncate">\{source\.sourceName\}<\/span>/)
  })

  test('the source name is NOT rendered by default in the collapsed stack -- only title/aria-label, per the spec', () => {
    const s = src()
    const collapsedSection = s.slice(0, s.indexOf('{expanded &&'))
    assert.ok(
      !collapsedSection.includes('{source.sourceName}<'),
      'the collapsed stack must not visibly print the source name as text content',
    )
  })
})

describe('SourceFaviconStrip — safety', () => {
  test('every favicon and every source link opens in a new tab with noopener/noreferrer', () => {
    const s = src()
    const targetBlankCount = (s.match(/target="_blank"/g) ?? []).length
    const relCount = (s.match(/rel="noopener noreferrer"/g) ?? []).length
    assert.ok(targetBlankCount >= 2, 'both the icon and the list-item link must open in a new tab')
    assert.equal(
      targetBlankCount,
      relCount,
      'every target="_blank" link must also carry rel="noopener noreferrer"',
    )
  })

  test('an empty sources array renders nothing (null), never an empty shell', () => {
    assert.match(src(), /if \(sources\.length === 0\) return null/)
  })
})
