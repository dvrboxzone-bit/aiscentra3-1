import '../../../lib/test-utils/dom-setup'

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { render } from '@testing-library/react'
import { forceReducedMotion } from '../../../app/__tests__/homepage-fixtures'

describe('/assistant — real ObservatoryChat rendered unchanged, VfinalPublicShell, no forbidden URLs', () => {
  test('the real /assistant page renders the real, unmodified ObservatoryChat component (example queries, input, send affordance) inside VfinalPublicShell', async (t) => {
    const restore = forceReducedMotion()
    t.after(restore)

    const { default: AssistantPage } = await import('../../../app/assistant/page')
    const { container } = render(AssistantPage())

    assert.ok(container.querySelector('header#header'), 'the shared header must be present')
    assert.ok(container.querySelector('footer#footer'), 'the shared footer must be present')

    // Real ObservatoryChat content -- one of its own real, hardcoded
    // EXAMPLE_QUERIES strings, proving the ACTUAL chat.tsx component
    // rendered, not a rewritten stand-in.
    assert.match(
      container.innerHTML,
      /What are the most significant AI model releases recently\?/,
      'a real example query from the actual chat.tsx component must render',
    )

    // Real chat input exists (a textarea, per chat.tsx's own real
    // implementation).
    assert.ok(container.querySelector('textarea'), 'the real chat input textarea must be present')

    assert.doesNotMatch(container.innerHTML, /href="#"/)
    assert.doesNotMatch(container.innerHTML, /picsum/i)
    assert.doesNotMatch(container.innerHTML, /z-cdn/i)
  })
})
