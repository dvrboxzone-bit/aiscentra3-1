/**
 * AIscentra — jsdom bootstrap for real React/DOM tests
 *
 * This project's test runner is Node's native `node:test`, which has
 * no built-in DOM environment (unlike Vitest/Jest). Import this module
 * FIRST (before any @testing-library/react or React import) in any
 * test file that needs to render real components and assert on real
 * DOM structure/accessibility -- not just source-text pattern matching.
 *
 * `navigator` needs Object.defineProperty rather than direct
 * assignment: Node 22+ ships a built-in read-only `globalThis.navigator`
 * getter, which a plain `globalThis.navigator = ...` throws against.
 */
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).window = dom.window
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).document = dom.window.document
Object.defineProperty(globalThis, 'navigator', {
  value: dom.window.navigator,
  configurable: true,
})
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).HTMLElement = dom.window.HTMLElement
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).Element = dom.window.Element
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).SVGElement = dom.window.SVGElement
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).Node = dom.window.Node
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).DocumentFragment = dom.window.DocumentFragment
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).MouseEvent = dom.window.MouseEvent
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).Event = dom.window.Event
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).getComputedStyle = dom.window.getComputedStyle
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).MutationObserver = dom.window.MutationObserver

// REAL BUG FIXED (independent review): rendering a real page tree that
// uses next/link (which internally calls requestIdleCallback, itself
// referencing the browser global `self`) or a component that queries
// window.matchMedia (e.g. any prefers-reduced-motion check) previously
// crashed with "self is not defined" / "window.matchMedia is not a
// function" -- neither global was set up here. `self` is simply an
// alias for the window object in real browsers; matchMedia's own
// return shape (MediaQueryList) is stubbed minimally (matches: false
// by default) since no test in this project relies on jsdom's own
// CSS media-query evaluation, only on components calling matchMedia()
// and checking its `.matches` boolean.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).self = dom.window
if (typeof dom.window.matchMedia !== 'function') {
  dom.window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  })) as any
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).matchMedia = dom.window.matchMedia

// REAL BUG FIXED (independent review): the real `lenis` npm package's
// own Dimensions class checks `this.wrapper instanceof Window` (the
// CLASS/constructor, not the window instance already set as
// globalThis.window above) and constructs a real `new
// ResizeObserver(...)` -- neither the Window class nor ResizeObserver
// were exposed globally here, causing a genuine "Window is not
// defined" crash when rendering any real page that mounts
// VfinalLenisProvider. jsdom's own window instance already carries its
// real Window class as its own constructor -- exposed here rather than
// hand-rolled. ResizeObserver has no real jsdom implementation; a
// minimal no-op stub is sufficient since no test in this project
// asserts on real resize-triggered layout recalculation.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).Window = dom.window.constructor
if (typeof (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
}

// REAL BUG FIXED (independent review): VfinalHeroGlobe and
// VfinalStrategicMemoryCanvas both unconditionally construct a real
// `new IntersectionObserver(...)` on mount (even under
// prefers-reduced-motion, which only gates whether the ANIMATION LOOP
// itself starts) -- without any IntersectionObserver implementation in
// this jsdom environment at all, rendering either component crashes
// with "IntersectionObserver is not defined". A minimal, inert stub
// (never fires its callback) is sufficient here: no test in this file
// relies on jsdom itself triggering real viewport intersection: tests
// that need that behavior provide and fire their own explicit fake
// observer (see vfinal-hero-globe.test.ts and
// vfinal-strategic-memory-canvas.dom.test.tsx).
if (
  typeof (globalThis as unknown as { IntersectionObserver?: unknown }).IntersectionObserver ===
  'undefined'
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).IntersectionObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
}

// REAL BUG FIXED (independent review): jsdom has no real rendering
// loop, so it does not implement requestAnimationFrame/
// cancelAnimationFrame at all -- the real `lenis` package's own raf
// loop (VfinalLenisProvider) and this project's own Hero Globe/
// Strategic Memory Canvas components all call these directly,
// crashing with "requestAnimationFrame is not defined" without a real
// (even if inert) implementation. A timer-based stand-in is sufficient
// for every test in this project that has needed one so far -- none
// assert on genuine 60fps timing, only on whether/how often a frame
// was scheduled (already covered by each component's own dedicated
// unit tests using their own explicit rAF mocks).
if (
  typeof (globalThis as unknown as { requestAnimationFrame?: unknown }).requestAnimationFrame ===
  'undefined'
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).requestAnimationFrame = (
    cb: FrameRequestCallback,
  ): ReturnType<typeof setTimeout> => setTimeout(() => cb(Date.now()), 16)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).cancelAnimationFrame = (id: ReturnType<typeof setTimeout>): void =>
    clearTimeout(id)
}

export { dom }
