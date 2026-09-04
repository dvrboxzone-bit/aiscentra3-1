import '../../../lib/test-utils/dom-setup'

import { afterEach, beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanup, render } from '@testing-library/react'
import { VfinalHeroDensityScan } from '../vfinal-hero-density-scan'

let rafCalls = 0
let reducedMotion = false
let observerCallback: IntersectionObserverCallback | null = null
let rafCallback: FrameRequestCallback | null = null

beforeEach(() => {
  rafCalls = 0
  reducedMotion = false
  observerCallback = null
  rafCallback = null
  window.matchMedia = ((query: string) => ({
    matches: query.includes('prefers-reduced-motion') && reducedMotion,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  })) as any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).requestAnimationFrame = (callback: FrameRequestCallback) => {
    rafCallback = callback
    return ++rafCalls
  }
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
  HTMLElement.prototype.getBoundingClientRect = () => ({ width: 520, height: 308 }) as DOMRect
  window.HTMLCanvasElement.prototype.getBoundingClientRect = () =>
    ({ width: 520, height: 70 }) as DOMRect
})

afterEach(() => {
  cleanup()
  document.body.replaceChildren()
})

describe('VfinalHeroDensityScan', () => {
  test('renders the approved status, SIG count and canvas without placeholder symbols', () => {
    const { container } = render(<VfinalHeroDensityScan />)
    // REAL SITE STRUCTURE CHANGE, then REVERTED (explicit owner
    // instruction, 2026-09-03): "SYSTEM: SCANNING" was briefly removed
    // in an earlier commit this same session, then explicitly
    // restored by the owner in a later, direct correction. Real,
    // current state: present.
    assert.match(container.textContent ?? '', /SYSTEM: SCANNING/)
    assert.match(container.textContent ?? '', /SIG/)
    assert.match(container.textContent ?? '', /574,780/)
    assert.doesNotMatch(container.textContent ?? '', /SIGNALS INDEXED|—/)
    const canvas = container.querySelector<HTMLCanvasElement>('canvas#hero-density-scan')
    assert.ok(canvas)
    assert.equal(canvas.style.height, '', 'CSS remains the source of the approved 70/50px height')
    assert.equal(canvas.height, 70, 'bitmap height follows the canvas, not the 308px wrapper')
  })

  test('keeps the required breathing animation running under reduced motion', () => {
    reducedMotion = true
    render(<VfinalHeroDensityScan />)
    assert.equal(rafCalls, 1)
    assert.ok(rafCallback, 'the breathing loop schedules its next frame')
    assert.ok(observerCallback, 'the canvas still registers viewport cleanup')
  })
})
