/**
 * AIscentra — real list-page metadata.title: no double-branding.
 *
 * REAL BUG FIXED (independent audit, not a typo): root layout.tsx's
 * own metadata.title.template is '%s | AIscentra' -- a list page
 * setting title: 'Events — AIscentra' would render as the genuinely
 * double-branded "Events — AIscentra | AIscentra", not a cosmetic
 * issue. Confirmed by reading the real layout.tsx template string
 * directly, not assumed.
 *
 * Reads the REAL, statically-exported `metadata` const from each real
 * page module -- no mock.module() needed (metadata is a plain object
 * export, not a query-dependent render), so no risk of the confirmed
 * cross-test module-cache interference this project's mock.module()
 * exhibits when mixed with unmocked imports of the same specifier in
 * one file.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('/events and /reports list pages — real metadata.title, no double-branding', () => {
  test('the real root layout.tsx genuinely uses the "%s | AIscentra" title template (confirms the double-branding risk is real, not hypothetical)', () => {
    const layoutSrc = readFileSync(join(__dirname, '..', '..', '..', 'app', 'layout.tsx'), 'utf-8')
    assert.match(
      layoutSrc,
      /template:\s*'%s \| AIscentra'/,
      'the real template must exist as assumed',
    )
  })

  test('the real /events page module exports metadata.title exactly "Events"', async () => {
    const { metadata } = await import('../../../app/(public)/events/page')
    assert.equal(
      metadata.title,
      'Events',
      'metadata.title must be the bare page name -- the root template supplies the " | AIscentra" suffix automatically',
    )
  })

  test('the real /reports page module exports metadata.title exactly "Reports"', async () => {
    const { metadata } = await import('../../../app/(public)/reports/page')
    assert.equal(metadata.title, 'Reports')
  })
})
