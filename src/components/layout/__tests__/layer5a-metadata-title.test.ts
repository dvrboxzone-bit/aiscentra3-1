/**
 * AIscentra — real /about and /signals metadata.title: no double-
 * branding (checkpoint 5A correction).
 *
 * REAL BUG FIXED (independent audit, not a typo, same real defect
 * class already closed for /events and /reports): root layout.tsx's
 * own metadata.title.template is '%s | AIscentra' -- /about and
 * /signals previously set title: 'About — AIscentra' / 'Signals —
 * AIscentra', which the real Next.js metadata system interpolates
 * into the genuinely double-branded "About — AIscentra | AIscentra" /
 * "Signals — AIscentra | AIscentra".
 *
 * Two layers of proof, matching the established convention:
 * 1. Source-level: the real page module's own exported metadata.title
 *    is exactly the bare page name.
 * 2. Final-HTML-equivalent: computes the REAL Next.js '%s'
 *    interpolation (a simple, explicitly documented string.replace,
 *    not a reimplementation of Next.js's own metadata resolution
 *    logic) against the REAL extracted template string and the REAL
 *    extracted page title -- proving, from the real production
 *    ingredients, that the resolved title is exactly "About |
 *    AIscentra" / "Signals | AIscentra", not merely that the raw
 *    title string looks right in isolation.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

function extractRealTemplate(): string {
  const layoutSrc = readFileSync(join(__dirname, '..', '..', '..', 'app', 'layout.tsx'), 'utf-8')
  const match = /template:\s*'([^']+)'/.exec(layoutSrc)
  if (!match?.[1])
    throw new Error('the real title template string could not be found in layout.tsx')
  return match[1]
}

describe('/about and /signals — real metadata.title, no double-branding', () => {
  test('the real /about page module exports metadata.title exactly "About"', async () => {
    const { metadata } = await import('../../../app/(public)/about/page')
    assert.equal(
      metadata.title,
      'About',
      'metadata.title must be the bare page name -- the root template supplies the " | AIscentra" suffix automatically',
    )
  })

  test('the real /signals page module exports generateMetadata whose default (no category) title is exactly "Signals"', async () => {
    const { generateMetadata } = await import('../../../app/(public)/signals/page')
    const metadata = await generateMetadata({ searchParams: Promise.resolve({}) })
    assert.equal(metadata.title, 'Signals')
  })

  test('interpolating the REAL root template against the REAL /about title produces exactly "About | AIscentra" -- the genuine final HTML <title> value, no double-branding', async () => {
    const realTemplate = extractRealTemplate()
    const { metadata: aboutMetadata } = await import('../../../app/(public)/about/page')
    const resolved = realTemplate.replace('%s', aboutMetadata.title as string)
    assert.equal(resolved, 'About | AIscentra')
    assert.doesNotMatch(
      resolved,
      /AIscentra.*AIscentra/,
      'the resolved title must never contain the brand name twice',
    )
  })

  test('interpolating the REAL root template against the REAL /signals default (no category) title produces exactly "Signals | AIscentra" -- the genuine final HTML <title> value, no double-branding', async () => {
    const realTemplate = extractRealTemplate()
    const { generateMetadata } = await import('../../../app/(public)/signals/page')
    const signalsMetadata = await generateMetadata({ searchParams: Promise.resolve({}) })
    const resolved = realTemplate.replace('%s', signalsMetadata.title as string)
    assert.equal(resolved, 'Signals | AIscentra')
    assert.doesNotMatch(
      resolved,
      /AIscentra.*AIscentra/,
      'the resolved title must never contain the brand name twice',
    )
  })
})
