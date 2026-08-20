import '../../../lib/test-utils/dom-setup'

import { describe, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { fireEvent, render } from '@testing-library/react'

describe('VfinalHeader mobile off-canvas menu', () => {
  test('supports dialog semantics, focus management, Escape and scroll lock', async (t) => {
    const navigationMock = mock.module('next/navigation', {
      namedExports: { usePathname: () => '/' },
    })
    t.after(() => navigationMock.restore())
    const { VfinalHeader } = await import(`../vfinal-header?mobile=${Date.now()}`)
    const { getByRole, unmount } = render(<VfinalHeader />)
    t.after(unmount)

    const openButton = getByRole('button', { name: 'Open navigation menu' })
    fireEvent.click(openButton)

    const dialog = getByRole('dialog', { name: 'Mobile navigation' })
    assert.equal(openButton.getAttribute('aria-expanded'), 'true')
    assert.equal(document.body.style.overflow, 'hidden')
    assert.match(dialog.textContent ?? '', /Research/)
    assert.match(dialog.textContent ?? '', /Trajectories/)
    assert.match(dialog.textContent ?? '', /Security & Data/)
    assert.equal(document.activeElement, getByRole('button', { name: 'Close navigation menu' }))

    fireEvent.keyDown(document, { key: 'Escape' })
    await new Promise((resolve) => window.setTimeout(resolve, 10))
    assert.equal(openButton.getAttribute('aria-expanded'), 'false')
    assert.equal(document.activeElement, openButton)
    assert.equal(document.body.style.overflow, '')
  })

  test('overlay and navigation links close the menu', async (t) => {
    const navigationMock = mock.module('next/navigation', {
      namedExports: { usePathname: () => '/' },
    })
    t.after(() => navigationMock.restore())
    const { VfinalHeader } = await import(`../vfinal-header?mobile=${Date.now()}-links`)
    const { getByRole, getAllByRole, unmount } = render(<VfinalHeader />)
    t.after(unmount)
    const openButton = getByRole('button', { name: 'Open navigation menu' })

    fireEvent.click(openButton)
    fireEvent.click(getByRole('button', { name: 'Close menu overlay', hidden: true }))
    assert.equal(openButton.getAttribute('aria-expanded'), 'false')

    fireEvent.click(openButton)
    const mobileTrajectory = getAllByRole('link', { name: 'Trajectories' }).at(-1)
    assert.ok(mobileTrajectory)
    fireEvent.click(mobileTrajectory)
    assert.equal(openButton.getAttribute('aria-expanded'), 'false')
  })
})
