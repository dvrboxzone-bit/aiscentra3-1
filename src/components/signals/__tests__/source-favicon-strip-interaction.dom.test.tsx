/**
 * AIscentra — SourceFaviconStrip: real reveal-interaction tests (part 2/4)
 * See source-favicon-strip-structure.dom.test.tsx for the split rationale.
 */
import '../../../lib/test-utils/dom-setup'

import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { SourceFaviconStrip } from '../source-favicon-strip'

afterEach(() => {
  cleanup()
  document.body.replaceChildren()
})

function makeSources(
  n: number,
): Array<{ url: string; sourceName: string; faviconUrl: string | null }> {
  return Array.from({ length: n }, (_, i) => ({
    url: `https://source-${i}.example.com/article`,
    sourceName: `Source ${i}`,
    faviconUrl: `https://source-${i}.example.com/favicon.ico`,
  }))
}

describe('SourceFaviconStrip — reveal on hover and click (real interaction)', () => {
  test('hovering the container reveals the full list', async () => {
    const user = userEvent.setup({ delay: null })
    const { container } = render(
      React.createElement(SourceFaviconStrip, { sources: makeSources(5) }),
    )
    assert.equal(screen.queryByRole('list'), null, 'list is collapsed initially')

    const outer = container.firstElementChild as HTMLElement
    await user.hover(outer)
    assert.ok(screen.getByRole('list'), 'hovering the container must reveal the full list')

    await user.unhover(outer)
    assert.equal(screen.queryByRole('list'), null, 'unhovering must collapse it again')
  })

  test('clicking the toggle button reveals the list -- real onClick, not hover-only', async () => {
    const user = userEvent.setup({ delay: null })
    render(React.createElement(SourceFaviconStrip, { sources: makeSources(5) }))
    const toggle = screen.getByRole('button')

    assert.equal(toggle.getAttribute('aria-expanded'), 'false')
    await user.click(toggle)
    assert.equal(
      toggle.getAttribute('aria-expanded'),
      'true',
      'a real click (which also fires a real hover sequence first, matching actual browser behavior) must leave the list open, not race hover and cancel back to closed',
    )
    assert.ok(screen.getByRole('list'))
  })

  test('clicking the toggle again while already open keeps it open (no accidental close-on-second-click)', async () => {
    const user = userEvent.setup({ delay: null })
    render(React.createElement(SourceFaviconStrip, { sources: makeSources(5) }))
    const toggle = screen.getByRole('button')
    await user.click(toggle)
    assert.ok(screen.getByRole('list'))
    await user.click(toggle)
    assert.ok(screen.getByRole('list'), 'a second click must not close what click already opened')
  })
})

describe('SourceFaviconStrip — reveal on keyboard focus, and dismissal', () => {
  test('Tab (keyboard focus) onto any source icon reveals the list, without a mouse', async () => {
    const user = userEvent.setup({ delay: null })
    render(React.createElement(SourceFaviconStrip, { sources: makeSources(3) }))
    assert.equal(screen.queryByRole('list'), null)

    await user.tab() // focuses the first stacked <a>
    assert.ok(
      screen.getByRole('list'),
      'keyboard focus on a source icon must reveal the list -- required independently of hover/click',
    )
  })

  test('focus moving away from the whole component collapses the list', async () => {
    const user = userEvent.setup({ delay: null })
    render(
      React.createElement(
        'div',
        null,
        React.createElement(SourceFaviconStrip, { sources: makeSources(2) }),
        React.createElement('button', { type: 'button', 'data-testid': 'outside-btn' }, 'outside'),
      ),
    )
    const insideLink = screen.getAllByRole('link')[0] as HTMLElement
    await user.click(insideLink)
    assert.ok(screen.getByRole('list'), 'still expanded while focus is inside the component')

    const outsideBtn = screen.getByTestId('outside-btn')
    await user.click(outsideBtn)
    assert.equal(
      screen.queryByRole('list'),
      null,
      'focus leaving the component entirely must collapse it',
    )
  })

  test('clicking outside the component collapses an open list', async () => {
    const user = userEvent.setup({ delay: null })
    render(
      React.createElement(
        'div',
        null,
        React.createElement(SourceFaviconStrip, { sources: makeSources(2) }),
        React.createElement('div', { 'data-testid': 'outside' }, 'outside content'),
      ),
    )
    const toggle = screen.getByRole('button')
    await user.click(toggle)
    assert.ok(screen.getByRole('list'))

    await user.click(screen.getByTestId('outside'))
    assert.equal(
      screen.queryByRole('list'),
      null,
      'a real mousedown outside the component must close the list',
    )
  })
})
