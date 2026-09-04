/**
 * AIscentra — HomePage (vfinal, layer 4): structural regression tests
 * (section order/count, History slider, image slots, forbidden URLs).
 *
 * Tests the REAL src/app/page.tsx component (dynamically imported),
 * not a rewritten copy -- getFeaturedSignals/getSignals are
 * substituted via node:test's real
 * mock.module() (--experimental-test-module-mocks), the same
 * established pattern already used for opengraph-image.moduleMock.test.ts.
 *
 * One render, reused across all assertions in this file (all real
 * regressions this file guards against are visible in a single
 * full-data render) -- deliberately isolated into its own process
 * (matching this project's own established "hard-to-mock scenarios
 * get their own file" convention) so this file's own mock.module()
 * registration never interacts with a DIFFERENT input scenario's own
 * registration in a sibling file.
 */
import '../../lib/test-utils/dom-setup'

import { test, describe, mock } from 'node:test'
import assert from 'node:assert/strict'
import { render } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sixRealSignals, twoRealObservations, forceReducedMotion } from './homepage-fixtures'

describe('HomePage (vfinal) — structural regressions: section order/count, slider, image slots, forbidden URLs', () => {
  test('all real structural invariants hold on a single full-data render', async (t) => {
    const restoreMatchMedia = forceReducedMotion()
    t.after(restoreMatchMedia)

    mock.module('@/modules/signals/queries', {
      namedExports: {
        getFeaturedSignals: async () => sixRealSignals(),
        getSignals: async () => twoRealObservations(),
      },
    })
    const { default: HomePage } = await import('../(public)/page')
    const jsx = await HomePage()
    const { container } = render(jsx)

    // 1. Exact section order (7 sections, approved sequence after
    // Trajectories moved to /trajectories AND Assistant moved to the
    // real sliding side panel -- both independent-review corrections,
    // explicit owner instruction). REAL ADDITION, 2026-09-03: a real
    // "quote" section added between hero and signals (moved out of
    // the hero itself into its own standalone block, explicit owner
    // instruction) -- now 7 real sections, not 6.
    const sectionIds = Array.from(container.querySelectorAll('section')).map((el) => el.id)
    assert.deepEqual(
      sectionIds,
      ['hero', 'quote', 'signals', 'forecasts', 'news', 'memory', 'signal-001'],
      'all 7 sections must be present in the exact approved order',
    )

    // 2. Exactly 6 Featured Signal cards with a full real result.
    assert.equal(container.querySelectorAll('[data-content-slot="signal"]').length, 6)

    // 3. Exactly 2 Observation cards with a full real result.
    assert.equal(container.querySelectorAll('[data-content-slot="observation"]').length, 2)

    // 4. Trajectory records moved to their own /trajectories page --
    // independent-review correction, explicit owner instruction. No
    // longer present on the homepage at all.
    assert.equal(container.querySelectorAll('[data-content-slot="trajectory"]').length, 0)
    assert.equal(container.querySelectorAll('a[href*="/history/"]').length, 0)
    assert.equal(container.querySelectorAll('[data-component="hero-density-scan"]').length, 1)
    assert.equal(container.querySelectorAll('[data-section="telemetry"]').length, 0)
    assert.equal(container.querySelectorAll('.hero-globe-container').length, 0)

    // 5. Exactly two History slider-container blocks, each with exactly
    //    two slider-slide subblocks.
    const sliders = container.querySelectorAll('.slider-container')
    assert.equal(
      sliders.length,
      2,
      'the History section must have exactly 2 slider-container blocks',
    )
    sliders.forEach((slider, i) => {
      assert.equal(
        slider.querySelectorAll('.slider-slide').length,
        2,
        `slider ${i} must have exactly 2 slider-slide subblocks`,
      )
    })

    // 6. Exactly 14 total image slots (6 Featured + 2 Forecasts + 2
    //    Observations + 4 History slider slides).
    assert.equal(container.querySelectorAll('[data-image-slot="local-asset"]').length, 14)
    assert.equal(container.querySelectorAll('img[src^="/images/"][src$=".webp"]').length, 14)
    assert.equal(
      container.querySelectorAll('[data-asset-purpose="forecast"].group > img.img-mono').length,
      2,
      'both Forecast images must activate the shared color-on-hover contract',
    )

    // 7. No Picsum, z-cdn, or literal href="#" anywhere on the real page.
    const html = container.innerHTML
    assert.doesNotMatch(html, /picsum/i)
    assert.doesNotMatch(html, /z-cdn/i)
    assert.doesNotMatch(html, /href="#"/)
  })
})

describe('removed globe/Three.js contract', () => {
  test('runtime package metadata no longer contains Three.js', () => {
    const pkg = JSON.parse(
      readFileSync(join(__dirname, '..', '..', '..', 'package.json'), 'utf-8'),
    ) as { dependencies: Record<string, string>; devDependencies: Record<string, string> }
    assert.equal(pkg.dependencies.three, undefined)
    assert.equal(pkg.devDependencies['@types/three'], undefined)
  })
})

describe('globals.css — real 10s infinite linear fade animation for the History slider (source-level)', () => {
  test('the real vf-slideFade keyframe animation (10s infinite linear) is genuinely defined and applied to .slider-slide', () => {
    const css = readFileSync(join(__dirname, '..', 'globals.css'), 'utf-8')
    assert.match(
      css,
      /\.slider-slide\s*\{[^}]*animation:\s*vf-slideFade\s+10s\s+infinite\s+linear/,
      '.slider-slide must genuinely use the real 10s infinite linear fade animation',
    )
    assert.match(css, /@keyframes vf-slideFade/, 'the real keyframe definition must exist')
  })
})

describe('layout.tsx — real self-hosted fonts, no next/font/google build-time network dependency', () => {
  test('the real layout.tsx source no longer imports next/font/google at all', () => {
    const src = readFileSync(join(__dirname, '..', 'layout.tsx'), 'utf-8')
    assert.doesNotMatch(
      src,
      /from ['"]next\/font\/google['"]/,
      'next/font/google must be genuinely absent -- its build-time fetch to fonts.gstatic.com is the exact real build failure this fix closes',
    )
    assert.match(src, /@fontsource\/inter/)
    assert.match(src, /@fontsource\/jetbrains-mono/)
  })

  test("both @fontsource packages are pinned to their exact real installed version (5.3.0), matching this project's exact-version-dependency convention", () => {
    const pkg = JSON.parse(
      readFileSync(join(__dirname, '..', '..', '..', 'package.json'), 'utf-8'),
    ) as {
      dependencies: Record<string, string>
    }
    assert.equal(pkg.dependencies['@fontsource/inter'], '5.3.0')
    assert.equal(pkg.dependencies['@fontsource/jetbrains-mono'], '5.3.0')

    const lock = JSON.parse(
      readFileSync(join(__dirname, '..', '..', '..', 'package-lock.json'), 'utf-8'),
    ) as { packages: Record<string, { version?: string }> }
    assert.equal(lock.packages['node_modules/@fontsource/inter']?.version, '5.3.0')
    assert.equal(lock.packages['node_modules/@fontsource/jetbrains-mono']?.version, '5.3.0')
  })
})
