/**
 * AIscentra — SourceFaviconStrip: real DOM structure tests (part 1/4)
 *
 * Split into 4 files, per requirement, each running in its own
 * isolated node process (see run-tests.sh's DOM_TEST_FILES handling):
 * this specific jsdom + node:test + React combination showed real
 * symptoms of state accumulating across ~15+ sequential renders within
 * one process, eventually hanging past a certain point regardless of
 * cleanup(). Splitting into smaller per-concern files keeps each
 * process's total render/interaction count well below whatever
 * threshold triggers that.
 */
import '../../../lib/test-utils/dom-setup'

import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { render, screen, cleanup } from '@testing-library/react'
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

describe('SourceFaviconStrip — real DOM structure and HTML validity', () => {
  test('renders nothing for an empty sources array', () => {
    const { container } = render(React.createElement(SourceFaviconStrip, { sources: [] }))
    assert.equal(container.innerHTML, '')
  })

  test('no <a> is ever nested inside a <button> -- the real bug this fixes', () => {
    render(React.createElement(SourceFaviconStrip, { sources: makeSources(3) }))
    const buttons = document.querySelectorAll('button')
    assert.ok(buttons.length > 0, 'a toggle button must exist')
    for (const button of buttons) {
      assert.equal(
        button.querySelectorAll('a').length,
        0,
        'no <button> may contain an <a> -- invalid HTML, confuses assistive tech',
      )
    }
  })

  test('each source renders as its own top-level, independently focusable <a>', () => {
    render(React.createElement(SourceFaviconStrip, { sources: makeSources(3) }))
    const links = screen.getAllByRole('link')
    assert.equal(links.length, 3)
    for (const link of links) {
      assert.ok(link.getAttribute('href')?.startsWith('https://source-'))
      assert.equal(link.getAttribute('target'), '_blank')
      assert.equal(link.getAttribute('rel'), 'noopener noreferrer')
    }
  })

  test('more than 4 sources shows an overflow indicator and stacks the first 4', () => {
    render(React.createElement(SourceFaviconStrip, { sources: makeSources(6) }))
    const links = screen.getAllByRole('link')
    assert.equal(links.length, 4, 'only the first 4 render as stacked icons before expansion')
    assert.ok(screen.getByText('+2'))
  })

  test('no <a> is ever nested inside another <a> -- the real bug found via a real DOM assertion', () => {
    render(React.createElement(SourceFaviconStrip, { sources: makeSources(2) }))
    document.querySelectorAll('a').forEach((a) => {
      assert.equal(a.querySelectorAll('a').length, 0, '<a> cannot contain another <a>')
    })
  })
})
