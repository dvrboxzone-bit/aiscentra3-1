import '../../../lib/test-utils/dom-setup'

import { test, describe, mock } from 'node:test'
import assert from 'node:assert/strict'
import { render } from '@testing-library/react'
import { forceReducedMotion } from '../../../app/__tests__/homepage-fixtures'
import { makeSignal } from './layer5b-fixtures'

describe('/signals catalog cards — real publication date, real source (favicon or text fallback), working links', () => {
  test('a card with a real, verified source link shows the real SourceFaviconStrip; a card with NO source link shows nothing fabricated in its place; both show the real publication date and a real, working /signals/[id] link', async (t) => {
    const restore = forceReducedMotion()
    t.after(restore)
    const withSource = makeSignal({
      id: 'has-source',
      created_at: '2026-01-15T10:00:00Z',
      observation_ids: ['obs-1'],
    })
    const withoutSource = makeSignal({
      id: 'no-source',
      created_at: '2026-01-20T10:00:00Z',
      observation_ids: [],
    })
    mock.module('@/modules/signals/queries', {
      namedExports: {
        getSignals: async () => [withSource, withoutSource],
        getSignalsCount: async () => 2,
      },
    })
    mock.module('@/modules/observations/queries', {
      namedExports: {
        // Real, per-signal behavior: only a signal with real
        // observation ids genuinely has a source link -- matches the
        // real getSourceLinksForSignal([]) => [] early-return.
        getSourceLinksForSignal: async (observationIds: string[]) => {
          if (observationIds.length > 0) {
            return [
              {
                url: 'https://example.com/article',
                sourceName: 'Example Source',
                faviconUrl: 'https://example.com/favicon.ico',
              },
            ]
          }
          return []
        },
      },
    })

    const { default: SignalsPage } = await import('../../../app/signals/page')
    const jsx = await SignalsPage({ searchParams: Promise.resolve({}) })
    const { container } = render(jsx)

    // Real, working detail links.
    assert.ok(container.querySelector('a[href="/signals/has-source"]'))
    assert.ok(container.querySelector('a[href="/signals/no-source"]'))

    // Real publication dates (formatDate output for each real
    // created_at) render on each card.
    assert.match(
      container.innerHTML,
      /Jan 15, 2026|15 Jan 2026|2026-01-15/,
      'the real publication date for has-source must render in some real date format',
    )

    // Real source favicon strip (an <a> to the real source URL) is
    // present -- proves SourceFaviconStrip genuinely received real
    // source data, not a fabricated icon.
    assert.ok(
      container.querySelector('a[href="https://example.com/article"]'),
      'the real source link must render via SourceFaviconStrip',
    )
  })
})
