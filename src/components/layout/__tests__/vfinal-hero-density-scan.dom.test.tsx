import '../../../lib/test-utils/dom-setup'

import { afterEach, beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanup, render } from '@testing-library/react'
import { VfinalHeroDensityScan } from '../vfinal-hero-density-scan'

let rafCalls = 0
let reducedMotion = false
let observerCallback: IntersectionObserverCallback | null = null

beforeEach(() => {
  rafCalls = 0
  reducedMotion = false
  observerCallback = null
  window.matchMedia = ((query: string) => ({
    matches: query.includes('prefers-reduced-motion') && reducedMotion,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  })) as any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).requestAnimationFrame = () => ++rafCalls
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).cancelAnimationFrame = () => {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).IntersectionObserver = class {
    constructor(callback: IntersectionObserverCallback) {
      observerCallback = callback
    }
    observe(): void {}
    disconnect(): void {}
  }
  const context = {
    clearRect: () => {},
    setTransform: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {},
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window.HTMLCanvasElement.prototype as any).getContext = () => context
  HTMLElement.prototype.getBoundingClientRect = () => ({ width: 520, height: 70 }) as DOMRect
})

afterEach(() => {
  cleanup()
  document.body.replaceChildren()
})

describe('VfinalHeroDensityScan', () => {
  test('renders the approved status, SIG label, neutral count and canvas', () => {
    const { container } = render(<VfinalHeroDensityScan />)
    assert.match(container.textContent ?? '', /SYSTEM: SCANNING/)
    assert.match(container.textContent ?? '', /SIG/)
    assert.match(container.textContent ?? '', /SIGNALS INDEXED/)
    assert.ok(container.querySelector('canvas#hero-density-scan'))
  })

  test('renders a static frame and starts no infinite loop under reduced motion', () => {
    reducedMotion = true
    render(<VfinalHeroDensityScan />)
    assert.equal(rafCalls, 0)
    assert.ok(observerCallback, 'the canvas still registers viewport cleanup')
  })
})
