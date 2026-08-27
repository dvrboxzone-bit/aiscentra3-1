/**
 * AIscentra — VfinalStrategicMemoryCanvas: layer-3 regression tests
 * (cleanup/unmount, required animation under reduced motion, real
 * stop/restart offscreen)
 *
 * REAL BUG this closes (independent review): the animation loop's own
 * requestAnimationFrame call previously happened UNCONDITIONALLY as the
 * loop function's first statement, before checking viewport visibility
 * -- the browser kept scheduling and firing a new frame every ~16ms
 * even fully offscreen, with only the actual draw work skipped. This
 * is NOT a real stop. These tests prove the fix: requestAnimationFrame
 * is called ONLY after the observer reports intersecting, and genuinely
 * stops being called at all while offscreen.
 */
import '../../../lib/test-utils/dom-setup'

import { test, describe, afterEach, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { render, cleanup } from '@testing-library/react'
import React from 'react'
import { VfinalStrategicMemoryCanvas } from '../vfinal-strategic-memory-canvas'

let rafCallCount = 0
let rafCallbacksById: Map<number, FrameRequestCallback> = new Map()
let cancelledIds: Set<number> = new Set()
let nextRafId = 1
let intersectionCallback: ((entries: Array<{ isIntersecting: boolean }>) => void) | null = null
let observedElements: Element[] = []
let disconnectCalled = false
let reducedMotion = false
let recordedFonts: string[] = []

/** Fires a queued callback by ID, matching real browser semantics: a
 * cancelled ID never fires, exactly like a real cancelAnimationFrame()
 * call genuinely prevents its queued callback from ever running. */
function fireRaf(id: number): void {
  if (cancelledIds.has(id)) return
  const cb = rafCallbacksById.get(id)
  cb?.(0)
}

beforeEach(() => {
  rafCallCount = 0
  rafCallbacksById = new Map()
  cancelledIds = new Set()
  nextRafId = 1
  intersectionCallback = null
  observedElements = []
  disconnectCalled = false
  reducedMotion = false
  recordedFonts = []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) => {
    rafCallCount++
    const id = nextRafId++
    rafCallbacksById.set(id, cb)
    return id
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).cancelAnimationFrame = (id: number) => {
    cancelledIds.add(id)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).IntersectionObserver = class {
    constructor(cb: (entries: Array<{ isIntersecting: boolean }>) => void) {
      intersectionCallback = cb
    }
    observe(el: Element): void {
      observedElements.push(el)
    }
    disconnect(): void {
      disconnectCalled = true
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).window.matchMedia = (query: string) => ({
    matches: query.includes('prefers-reduced-motion') ? reducedMotion : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })

  // Minimal 2D-context stub -- real canvas drawing is not the thing
  // under test here (that's genuine, real Knowledge Graph illustration
  // data, not fabricated numbers); only the RAF scheduling control flow
  // is. Every method the component calls is a harmless no-op recorder.
  const ctxStub = {
    clearRect: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {},
    fill: () => {},
    arc: () => {},
    fillText: () => {},
    save: () => {},
    restore: () => {},
    translate: () => {},
    scale: () => {},
    setLineDash: () => {},
    set font(value: string) {
      recordedFonts.push(value)
    },
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).window.HTMLCanvasElement.prototype.getContext = () => ctxStub
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).HTMLElement.prototype.getBoundingClientRect = () => ({
    width: 400,
    height: 300,
    top: 0,
    left: 0,
    right: 400,
    bottom: 300,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  })
})

afterEach(() => {
  cleanup()
  document.body.replaceChildren()
})

describe('VfinalStrategicMemoryCanvas — real stop/restart, not merely skipped draw', () => {
  test('mounts, schedules exactly one initial animation frame (the loop has genuinely started)', () => {
    render(React.createElement(VfinalStrategicMemoryCanvas))
    assert.equal(
      rafCallCount,
      1,
      'exactly one requestAnimationFrame call on mount -- the loop has started',
    )
  })

  test('going offscreen genuinely STOPS the loop from scheduling any further frame -- not merely skipping the draw while still being called every frame', () => {
    render(React.createElement(VfinalStrategicMemoryCanvas))
    const countAfterMount = rafCallCount
    assert.ok(intersectionCallback, 'an IntersectionObserver callback must have been registered')
    assert.equal(rafCallbacksById.size, 1, 'exactly one frame must be queued after mount')
    const pendingId = [...rafCallbacksById.keys()][0]

    // Simulate the element going offscreen -- the component's own
    // observer callback must call cancelAnimationFrame for the
    // currently-queued frame.
    intersectionCallback?.([{ isIntersecting: false }])
    assert.ok(
      pendingId !== undefined && cancelledIds.has(pendingId),
      'the queued frame must genuinely be cancelled once offscreen',
    )

    // Attempt to fire that same frame -- fireRaf() faithfully matches
    // real browser semantics: a cancelled requestAnimationFrame ID
    // never actually invokes its callback. With the real bug (rAF
    // scheduled unconditionally, never actually cancelled), this
    // frame would still fire and reschedule itself.
    if (pendingId !== undefined) fireRaf(pendingId)

    assert.equal(
      rafCallCount,
      countAfterMount,
      'no new requestAnimationFrame call may happen once offscreen -- the loop must genuinely stop, not just skip its draw work while still being rescheduled',
    )
  })

  test('re-entering the viewport genuinely RESTARTS the loop with a new requestAnimationFrame call', () => {
    render(React.createElement(VfinalStrategicMemoryCanvas))
    intersectionCallback?.([{ isIntersecting: false }])
    const countWhileOffscreen = rafCallCount

    intersectionCallback?.([{ isIntersecting: true }])

    assert.equal(
      rafCallCount,
      countWhileOffscreen + 1,
      'coming back into view must schedule exactly one new frame, genuinely restarting the loop',
    )
  })

  test('prefers-reduced-motion does not disable the required animation loop', () => {
    reducedMotion = true
    render(React.createElement(VfinalStrategicMemoryCanvas))
    assert.equal(
      rafCallCount,
      1,
      'the required strategic-memory animation must still start under reduced motion',
    )
  })

  test('uses the approved enlarged timeline font; node labels are real DOM elements, not canvas text (independent-review upgrade, 2026-08-26)', () => {
    const originalNow = Date.now
    let nowCalls = 0
    Date.now = () => (nowCalls++ === 0 ? 0 : 1000)
    let container: HTMLElement
    try {
      container = render(React.createElement(VfinalStrategicMemoryCanvas)).container
    } finally {
      Date.now = originalNow
    }
    assert.ok(recordedFonts.includes('24px JetBrains Mono'))
    // REAL ARCHITECTURE CHANGE: node labels moved out of ctx.fillText
    // into real, hoverable, bordered DOM elements (see the component's
    // own updated docstring) -- the old 20px node-label canvas font is
    // genuinely no longer drawn at all, not merely renamed.
    assert.equal(
      recordedFonts.includes('20px JetBrains Mono'),
      false,
      'node labels no longer render as canvas text at all',
    )
    const labels = container.querySelectorAll('.memory-label')
    assert.equal(labels.length, 11, 'all 11 real nodes must have a real DOM label element')
  })

  test('unmount fully disconnects the IntersectionObserver (real cleanup, not a leaked observer)', () => {
    const { unmount } = render(React.createElement(VfinalStrategicMemoryCanvas))
    assert.equal(disconnectCalled, false)
    unmount()
    assert.equal(
      disconnectCalled,
      true,
      'IntersectionObserver.disconnect() must be called on unmount',
    )
  })
})
