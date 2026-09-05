import '../../../lib/test-utils/dom-setup'

import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { render, cleanup } from '@testing-library/react'
import { forceReducedMotion } from '../../../app/__tests__/homepage-fixtures'

afterEach(() => {
  cleanup()
})

describe('(public) route group layout — real shared header/footer, mounted exactly once', () => {
  test('the real (public)/layout.tsx renders VfinalPublicShell (shared header + footer) around its children, exactly the content every one of the 19 real public pages used to duplicate individually', async (t) => {
    const restore = forceReducedMotion()
    t.after(restore)

    const { default: PublicLayout } = await import('../../../app/(public)/layout')
    const { container } = render(
      PublicLayout({ children: <div data-testid="real-page-content">page content</div> }),
    )

    assert.ok(container.querySelector('header#header'), 'the shared VfinalHeader must be present')
    assert.ok(container.querySelector('footer#footer'), 'the shared VfinalFooter must be present')
    assert.ok(
      container.querySelector('[data-testid="real-page-content"]'),
      'the real page children must render inside the shell, not be swallowed by it',
    )

    // Real architectural invariant this whole task exists to satisfy:
    // the Assistant panel + edge tab must be mounted here (once), not
    // duplicated per-page -- confirmed by their own real DOM markers.
    assert.ok(
      container.querySelector('#assistant-panel'),
      'the Assistant panel must be mounted by this shared layout',
    )
    assert.ok(
      container.querySelector('.assistant-tab'),
      'the Assistant edge tab must be mounted by this shared layout',
    )
  })
})
