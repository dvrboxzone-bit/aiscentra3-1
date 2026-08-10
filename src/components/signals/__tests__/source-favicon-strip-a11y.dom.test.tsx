/**
 * AIscentra — SourceFaviconStrip: real accessibility-semantics tests (part 3/4)
 * See source-favicon-strip-structure.dom.test.tsx for the split rationale.
 */
import '../../../lib/test-utils/dom-setup'

import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { render, screen, cleanup, within } from '@testing-library/react'
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

describe('SourceFaviconStrip — accessibility semantics', () => {
  test('the toggle button has aria-expanded and aria-controls pointing at the real list id', async () => {
    const user = userEvent.setup({ delay: null })
    render(React.createElement(SourceFaviconStrip, { sources: makeSources(3) }))
    const toggle = screen.getByRole('button')
    const controlsId = toggle.getAttribute('aria-controls')
    assert.ok(controlsId, 'aria-controls must be set')

    await user.click(toggle)
    const list = screen.getByRole('list')
    assert.equal(
      list.id,
      controlsId,
      'aria-controls must reference the ACTUAL rendered list element id',
    )
  })

  test('each collapsed icon exposes an accessible name via aria-label, not just a title tooltip', () => {
    render(React.createElement(SourceFaviconStrip, { sources: makeSources(2) }))
    const link0 = screen.getByRole('link', { name: 'Open source: Source 0' })
    assert.ok(link0)
  })

  test('the expanded list shows the real source name as visible text for every entry', async () => {
    const user = userEvent.setup({ delay: null })
    render(React.createElement(SourceFaviconStrip, { sources: makeSources(3) }))
    await user.click(screen.getByRole('button'))
    const list = screen.getByRole('list')
    for (let i = 0; i < 3; i++) {
      assert.ok(within(list).getByText(`Source ${i}`))
    }
  })

  test('the source name is NOT visible text in the collapsed stack -- only in the expanded list', () => {
    render(React.createElement(SourceFaviconStrip, { sources: makeSources(1) }))
    assert.equal(
      screen.queryByText('Source 0'),
      null,
      'collapsed view must not print the name as text content',
    )
  })
})
