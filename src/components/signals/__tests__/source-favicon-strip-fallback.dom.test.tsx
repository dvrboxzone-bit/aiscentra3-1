/**
 * AIscentra — SourceFaviconStrip: real missing/failed favicon fallback tests (part 4/4)
 * See source-favicon-strip-structure.dom.test.tsx for the split rationale.
 */
import '../../../lib/test-utils/dom-setup'

import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import React from 'react'
import { SourceFaviconStrip } from '../source-favicon-strip'

afterEach(() => {
  cleanup()
  document.body.replaceChildren()
})

describe('SourceFaviconStrip — missing/failed favicon fallback (real DOM)', () => {
  test('a source with no faviconUrl renders the neutral initial-letter fallback, not an <img>', () => {
    render(
      React.createElement(SourceFaviconStrip, {
        sources: [{ url: 'https://example.com/a', sourceName: 'Zephyr News', faviconUrl: null }],
      }),
    )
    const link = screen.getByRole('link', { name: 'Open source: Zephyr News' })
    assert.equal(link.querySelector('img'), null, 'no favicon URL means no <img> attempt at all')
    assert.equal(link.textContent, 'Z', 'falls back to the first letter of the source name')
  })

  test('an <img> load failure (onError) swaps to the same neutral fallback at runtime', () => {
    render(
      React.createElement(SourceFaviconStrip, {
        sources: [
          {
            url: 'https://example.com/a',
            sourceName: 'Broken Icon Co',
            faviconUrl: 'https://example.com/favicon.ico',
          },
        ],
      }),
    )
    const link = screen.getByRole('link', { name: 'Open source: Broken Icon Co' })
    const img = link.querySelector('img')
    assert.ok(img, 'an img is attempted when a faviconUrl is present')

    // Real DOM 'error' event via testing-library's own fireEvent
    // wrapper (not a raw img.dispatchEvent(new Event('error')) -- that
    // specific combination hung indefinitely in this project's
    // jsdom + node:test + React 19 setup, isolated and confirmed as a
    // real, reproducible environment interaction, not a flaky fluke.
    // fireEvent.error is the same real DOM event, dispatched through
    // testing-library's own act()-wrapped helper instead.
    if (img) fireEvent.error(img)

    assert.equal(
      link.querySelector('img'),
      null,
      'a failed image must be removed/replaced, not left broken',
    )
    assert.equal(link.textContent, 'B')
  })

  test('multiple sources with mixed favicon success/failure each fall back independently', () => {
    render(
      React.createElement(SourceFaviconStrip, {
        sources: [
          {
            url: 'https://a.example.com/1',
            sourceName: 'Alpha',
            faviconUrl: 'https://a.example.com/favicon.ico',
          },
          { url: 'https://b.example.com/2', sourceName: 'Beta', faviconUrl: null },
        ],
      }),
    )
    const alphaLink = screen.getByRole('link', { name: 'Open source: Alpha' })
    const betaLink = screen.getByRole('link', { name: 'Open source: Beta' })
    assert.ok(alphaLink.querySelector('img'), 'Alpha has a favicon URL, so an <img> is attempted')
    assert.equal(betaLink.querySelector('img'), null, 'Beta has no favicon URL, so no <img> at all')
    assert.equal(betaLink.textContent, 'B')
  })
})
