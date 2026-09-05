/**
 * AIscentra — VfinalProgressAndBackToTop scroll-progress boundary
 * regression (Public Interactivity Correction checkpoint)
 *
 * Confirms the progress bar's real scroll-percentage calculation stays
 * within [0, 100] and never produces NaN when there is no scrollable
 * content (scrollHeight === clientHeight, denom <= 0) -- the exact
 * edge case the checkpoint's own requirements call out explicitly.
 */
import '../../../lib/test-utils/dom-setup'

import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { render, cleanup } from '@testing-library/react'
import { VfinalProgressAndBackToTop } from '../vfinal-progress-back-to-top'

afterEach(() => {
  cleanup()
})

function setScrollMetrics(scrollTop: number, scrollHeight: number, clientHeight: number): void {
  Object.defineProperty(document.documentElement, 'scrollTop', {
    value: scrollTop,
    configurable: true,
  })
  Object.defineProperty(document.documentElement, 'scrollHeight', {
    value: scrollHeight,
    configurable: true,
  })
  Object.defineProperty(document.documentElement, 'clientHeight', {
    value: clientHeight,
    configurable: true,
  })
}

describe('VfinalProgressAndBackToTop — real scroll progress boundaries', () => {
  test('no scrollable content (scrollHeight === clientHeight): width is 0%, never NaN', (t) => {
    const { container, unmount } = render(<VfinalProgressAndBackToTop />)
    t.after(unmount)
    setScrollMetrics(0, 800, 800)
    window.dispatchEvent(new Event('scroll'))

    const bar = container.querySelector('#progress') as HTMLElement
    assert.ok(bar, '#progress element must exist')
    assert.equal(bar.style.width, '0%', 'with no scrollable content the bar must show 0%, not NaN%')
  })

  test('scrolled to the very top: 0%', (t) => {
    const { container, unmount } = render(<VfinalProgressAndBackToTop />)
    t.after(unmount)
    setScrollMetrics(0, 2000, 800)
    window.dispatchEvent(new Event('scroll'))

    const bar = container.querySelector('#progress') as HTMLElement
    assert.equal(bar.style.width, '0%')
  })

  test('scrolled to the very bottom: 100%', (t) => {
    const { container, unmount } = render(<VfinalProgressAndBackToTop />)
    t.after(unmount)
    setScrollMetrics(1200, 2000, 800) // denom = 2000-800 = 1200
    window.dispatchEvent(new Event('scroll'))

    const bar = container.querySelector('#progress') as HTMLElement
    assert.equal(bar.style.width, '100%')
  })

  test('back-to-top button becomes visible past 300px and hides at/under it', (t) => {
    const { container, unmount } = render(<VfinalProgressAndBackToTop />)
    t.after(unmount)
    const button = container.querySelector('#back-to-top') as HTMLElement

    setScrollMetrics(301, 2000, 800)
    window.dispatchEvent(new Event('scroll'))
    assert.equal(button.classList.contains('visible'), true)

    setScrollMetrics(200, 2000, 800)
    window.dispatchEvent(new Event('scroll'))
    assert.equal(button.classList.contains('visible'), false)
  })
})
