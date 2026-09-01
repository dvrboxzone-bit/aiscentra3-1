import '../../../lib/test-utils/dom-setup'

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { render } from '@testing-library/react'
import { forceReducedMotion } from '../../../app/__tests__/homepage-fixtures'

describe('/about — real anchor ids, VfinalPublicShell, no forbidden URLs', () => {
  test('the real /about page contains all 4 required anchor ids and uses VfinalPublicShell', async (t) => {
    const restore = forceReducedMotion()
    t.after(restore)
    const { default: AboutPage } = await import('../../../app/(public)/about/page')
    const { container } = render(AboutPage())
    for (const id of ['epistemic-model', 'methodology', 'security-data', 'roadmap']) {
      assert.ok(container.querySelector(`#${id}`), `#${id} must exist on the real /about page`)
    }
    const html = container.innerHTML
    assert.doesNotMatch(html, /href="#"/)
    assert.doesNotMatch(html, /picsum/i)
    assert.doesNotMatch(html, /z-cdn/i)
  })
})
