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

export { dom }
