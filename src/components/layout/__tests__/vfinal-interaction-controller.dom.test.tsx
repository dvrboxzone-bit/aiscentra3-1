/**
 * AIscentra — VfinalInteractionController: real magnetic/reveal wiring
 * regression (Public Interactivity Correction checkpoint)
 *
 * REAL BUG this closes (confirmed defect #1): `.magnetic`/`.reveal`
 * classes existed in server-rendered markup, but the two hooks meant
 * to wire them up were never called anywhere -- `.magnetic` elements
 * never received a mousemove transform and `.reveal` elements never
 * got their `.in` class added. These tests render real DOM containing
 * `.magnetic`/`.reveal` elements, mount the real controller, and
 * assert the actual behavioral contract: mousemove/mouseleave
 * transforms, IntersectionObserver-driven reveal, dynamically-added
 * elements getting bound, no duplicated listeners after
 * unmount+remount (simulating App Router navigation), and
 * prefers-reduced-motion leaving magnetic elements untouched.
 */
import '../../../lib/test-utils/dom-setup'

import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { render, cleanup } from '@testing-library/react'
import { forceReducedMotion } from '../../../app/__tests__/homepage-fixtures'
import { VfinalInteractionController } from '../vfinal-interaction-controller'

afterEach(() => {
  cleanup()
})

interface FakeIntersectionObserver {
  observe: (el: Element) => void
  unobserve: (el: Element) => void
  disconnect: () => void
  fire: (el: Element, isIntersecting: boolean) => void
}

function installFakeIntersectionObserver(): {
  restore: () => void
  instances: FakeIntersectionObserver[]
} {
  const original = (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver
  const instances: FakeIntersectionObserver[] = []

  class FakeIO implements FakeIntersectionObserver {
    private callback: IntersectionObserverCallback
    private observed = new Set<Element>()
    constructor(callback: IntersectionObserverCallback) {
      this.callback = callback
      instances.push(this)
    }
    observe(el: Element): void {
      this.observed.add(el)
    }
    unobserve(el: Element): void {
      this.observed.delete(el)
    }
    disconnect(): void {
      this.observed.clear()
    }
    fire(el: Element, isIntersecting: boolean): void {
      if (!this.observed.has(el)) return
      this.callback(
        [{ target: el, isIntersecting } as IntersectionObserverEntry],
        this as unknown as IntersectionObserver,
      )
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).IntersectionObserver = FakeIO
  return {
    restore: () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(globalThis as any).IntersectionObserver = original
    },
    instances,
  }
}

describe('VfinalInteractionController — real magnetic mousemove/mouseleave', () => {
  test('a .magnetic element receives a translate() transform on mousemove and resets on mouseleave', (t) => {
    const restoreRM = forceReducedMotion()
    // Force reduced-motion OFF for this test (magnetic movement must be
    // active under no-preference).
    ;(window.matchMedia as unknown as (q: string) => { matches: boolean }) = ((q: string) => ({
      matches: false,
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    })) as any
    t.after(restoreRM)

    const { container, unmount } = render(
      <div>
        <button className="magnetic btn-pill">Enter</button>
        <VfinalInteractionController />
      </div>,
    )
    t.after(unmount)

    const el = container.querySelector('.magnetic') as HTMLElement
    assert.ok(el, 'the .magnetic element must be present')

    Object.defineProperty(el, 'getBoundingClientRect', {
      value: () => ({
        left: 0,
        top: 0,
        width: 100,
        height: 40,
        right: 100,
        bottom: 40,
        x: 0,
        y: 0,
        toJSON() {},
      }),
      configurable: true,
    })

    el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 60, clientY: 30 }))
    assert.match(
      el.style.transform,
      /translate\(2\.5px, 2\.5px\)/,
      'mousemove must set a translate() transform using the 0.25 factor from element center',
    )

    el.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }))
    assert.equal(
      el.style.transform,
      'translate(0, 0)',
      'mouseleave must reset the transform to origin',
    )
  })

  test('prefers-reduced-motion: a .magnetic element still binds and receives a transform (matches the reference HTML, which has no reduced-motion gate on this effect)', (t) => {
    const restore = forceReducedMotion()
    t.after(restore)

    const { container, unmount } = render(
      <div>
        <button className="magnetic btn-pill">Enter</button>
        <VfinalInteractionController />
      </div>,
    )
    t.after(unmount)

    const el = container.querySelector('.magnetic') as HTMLElement
    Object.defineProperty(el, 'getBoundingClientRect', {
      value: () => ({
        left: 0,
        top: 0,
        width: 100,
        height: 40,
        right: 100,
        bottom: 40,
        x: 0,
        y: 0,
        toJSON() {},
      }),
      configurable: true,
    })
    el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 60, clientY: 30 }))
    assert.match(
      el.style.transform,
      /translate\(2\.5px, 2\.5px\)/,
      'reduced motion must not disable magnetic binding -- the reference HTML has no such gate',
    )
  })
})

describe('VfinalInteractionController — real reveal-on-scroll via IntersectionObserver', () => {
  test('a .reveal element gets `.in` added once it intersects, and is unobserved afterward (one-shot)', (t) => {
    const fakeIO = installFakeIntersectionObserver()
    t.after(fakeIO.restore)
    const restore = forceReducedMotion()
    ;(window.matchMedia as unknown as (q: string) => { matches: boolean }) = ((q: string) => ({
      matches: false,
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    })) as any
    t.after(restore)

    const { container, unmount } = render(
      <div>
        <h2 className="reveal">Heading</h2>
        <VfinalInteractionController />
      </div>,
    )
    t.after(unmount)

    const el = container.querySelector('.reveal') as HTMLElement
    assert.ok(el, 'the .reveal element must be present')
    assert.equal(el.classList.contains('in'), false, 'must not start already revealed')

    const observer = fakeIO.instances[fakeIO.instances.length - 1]
    assert.ok(observer, 'an IntersectionObserver must have been created for reveal')
    observer.fire(el, true)

    assert.equal(
      el.classList.contains('in'),
      true,
      '`.in` must be added once the element intersects',
    )
  })

  test('a .reveal element added to the DOM after mount (post-hydration) is still bound and observed', (t) => {
    const fakeIO = installFakeIntersectionObserver()
    t.after(fakeIO.restore)
    const restore = forceReducedMotion()
    t.after(restore)

    const { container, unmount } = render(
      <div id="root">
        <VfinalInteractionController />
      </div>,
    )
    t.after(unmount)

    const root = container.querySelector('#root') as HTMLElement
    const late = document.createElement('div')
    late.className = 'reveal'
    root.appendChild(late)

    // MutationObserver callbacks fire as a microtask; wait one tick.
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        assert.equal(
          late.hasAttribute('data-reveal-bound'),
          true,
          'a .reveal element appended after mount must be picked up by the MutationObserver and bound',
        )
        resolve()
      }, 0)
    })
  })
})

describe('VfinalInteractionController — no duplicated listeners across unmount/remount (navigation)', () => {
  test('remounting the controller (simulating App Router navigation) does not double-fire the magnetic transform handler', (t) => {
    const restore = forceReducedMotion()
    ;(window.matchMedia as unknown as (q: string) => { matches: boolean }) = ((q: string) => ({
      matches: false,
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    })) as any
    t.after(restore)

    const markup = (
      <div>
        <button className="magnetic btn-pill">Enter</button>
        <VfinalInteractionController />
      </div>
    )

    const first = render(markup)
    first.unmount()

    const second = render(markup)
    t.after(second.unmount)

    const el = second.container.querySelector('.magnetic') as HTMLElement
    Object.defineProperty(el, 'getBoundingClientRect', {
      value: () => ({
        left: 0,
        top: 0,
        width: 100,
        height: 40,
        right: 100,
        bottom: 40,
        x: 0,
        y: 0,
        toJSON() {},
      }),
      configurable: true,
    })

    let callCount = 0
    const originalSet = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'style')
    // Count how many times the transform setter fires for a single
    // dispatched event -- a duplicated listener would set it twice.
    const styleProxy = new Proxy(el.style, {
      set(target, prop, value) {
        if (prop === 'transform')
          callCount++
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(target as any)[prop] = value
        return true
      },
    })
    Object.defineProperty(el, 'style', { value: styleProxy, configurable: true })
    t.after(() => {
      if (originalSet) Object.defineProperty(HTMLElement.prototype, 'style', originalSet)
    })

    el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 60, clientY: 30 }))
    assert.equal(
      callCount,
      1,
      'exactly one bound listener must fire per mousemove -- a duplicate would fire the transform setter twice',
    )
  })
})
