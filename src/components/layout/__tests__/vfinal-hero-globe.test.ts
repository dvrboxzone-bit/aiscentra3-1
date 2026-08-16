/**
 * AIscentra — VfinalHeroGlobe: real stop/restart source-level regression
 *
 * jsdom has no real WebGL context, so THREE.WebGLRenderer cannot be
 * constructed genuinely in a DOM test environment. A mock.module()
 * substitution of the real 'three' npm package was attempted (matching
 * the project's own established --experimental-test-module-mocks
 * pattern already used elsewhere for path-aliased LOCAL modules) but
 * confirmed NOT to intercept a bare third-party npm specifier
 * ('three') when dynamically imported through a tsx-transformed .tsx
 * component -- verified via a minimal, isolated reproduction: the same
 * mock.module() call genuinely intercepts a plain .mjs file's import
 * of a Node built-in ('node:os'), but does not intercept 'three' when
 * resolved through tsx's own loader chain inside the real component.
 * This is a confirmed, real tooling limitation, not an oversight.
 *
 * Source-level assertion instead, matching the SAME established
 * pattern already used elsewhere in this project for exactly this
 * category of hard-to-directly-render scenario (e.g.
 * execution-lock.test.ts's own lock-before-processing check) --
 * verifying the real, fixed control-flow shape is genuinely present in
 * the source, and the old buggy shape is genuinely absent.
 *
 * REAL BUG this closes (independent review): requestAnimationFrame was
 * previously called unconditionally as animateGlobe's first statement,
 * before the isGlobeVisible check -- the loop kept firing (and
 * rescheduling itself) every frame even fully offscreen, with only the
 * animation/render work itself skipped. Fixed: requestAnimationFrame
 * is now called only at the END of the frame body (after doing real
 * work), and the IntersectionObserver callback explicitly calls
 * cancelAnimationFrame + resets rafId to 0 when leaving the viewport,
 * and re-schedules a frame when re-entering -- a genuine stop/restart,
 * not a skipped-draw-while-still-scheduled pattern.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

const SOURCE_PATH = join(__dirname, '..', 'vfinal-hero-globe.tsx')

describe('VfinalHeroGlobe source: real stop/restart, not merely skipped animation', () => {
  const src = (): string => readFileSync(SOURCE_PATH, 'utf-8')

  test('requestAnimationFrame is scheduled from the END of animateGlobe (after real work), not unconditionally as the first statement', () => {
    const text = src()
    const fnStart = text.indexOf('function animateGlobe(): void {')
    assert.ok(fnStart > 0, 'animateGlobe must exist')
    const fnEnd = text.indexOf('\n    }', fnStart)
    const body = text.slice(fnStart, fnEnd)

    const rafCallIndex = body.indexOf('rafId = requestAnimationFrame(animateGlobe)')
    const renderCallIndex = body.indexOf('renderer.render(scene, camera)')
    assert.ok(
      rafCallIndex > 0 && renderCallIndex > 0,
      'both calls must exist inside the frame body',
    )
    assert.ok(
      rafCallIndex > renderCallIndex,
      'requestAnimationFrame must be scheduled AFTER the real render work in this frame -- scheduling it as the first statement (before doing any work or checking visibility) is the exact real bug this test guards against',
    )
  })

  test('the IntersectionObserver callback genuinely calls cancelAnimationFrame and resets rafId to 0 when leaving the viewport', () => {
    const text = src()
    const observerStart = text.indexOf('const globeObserver = new IntersectionObserver(')
    assert.ok(observerStart > 0, 'globeObserver must exist')
    const observerEnd = text.indexOf('globeObserver.observe(container)', observerStart)
    const body = text.slice(observerStart, observerEnd)

    assert.match(
      body,
      /cancelAnimationFrame\(rafId\)/,
      'leaving the viewport must genuinely call cancelAnimationFrame on the currently-queued frame',
    )
    assert.match(
      body,
      /rafId\s*=\s*0/,
      'rafId must be reset to 0 once cancelled, so a later restart is genuinely possible',
    )
  })

  test('the IntersectionObserver callback genuinely re-schedules a new frame when re-entering the viewport, guarded against a redundant double-schedule', () => {
    const text = src()
    const observerStart = text.indexOf('const globeObserver = new IntersectionObserver(')
    const observerEnd = text.indexOf('globeObserver.observe(container)', observerStart)
    const body = text.slice(observerStart, observerEnd)

    assert.match(
      body,
      /if\s*\(rafId === 0\)\s*rafId = requestAnimationFrame\(animateGlobe\)/,
      're-entering the viewport must schedule a new frame only if none is already pending -- both restarting AND guarding against a duplicate loop',
    )
  })

  test('the old buggy shape (requestAnimationFrame as the unconditional first statement of the frame function) is genuinely absent from the source', () => {
    const text = src()
    assert.doesNotMatch(
      text,
      /function animateGlobe\(\): void \{\s*rafId = requestAnimationFrame\(animateGlobe\)/,
      'requestAnimationFrame must never be the first statement inside animateGlobe -- that exact shape is the real regression this test set exists to prevent',
    )
  })

  test('prefers-reduced-motion is checked before starting the loop -- animateGlobe() is only called in the else branch, a single renderer.render() happens in the reduced-motion branch instead', () => {
    const text = src()
    assert.match(
      text,
      /if \(prefersReducedMotion\) \{\s*\/\/[^\n]*\n[^\n]*\n[^\n]*\n\s*renderer\.render\(scene, camera\)\s*\} else \{\s*animateGlobe\(\)\s*\}/,
      'reduced-motion must render exactly one static frame and never call animateGlobe (which is what starts the requestAnimationFrame loop)',
    )
  })

  test('full cleanup on unmount: cancelAnimationFrame, both listeners removed, observer disconnected, renderer and every geometry/material disposed', () => {
    const text = src()
    const cleanupStart = text.indexOf('return () => {')
    assert.ok(cleanupStart > 0, 'a cleanup function must be returned from useEffect')
    const cleanupBody = text.slice(cleanupStart, text.indexOf('}, [])', cleanupStart))

    assert.match(cleanupBody, /cancelAnimationFrame\(rafId\)/)
    assert.match(cleanupBody, /document\.removeEventListener\('mousemove', onMouseMove\)/)
    assert.match(cleanupBody, /window\.removeEventListener\('resize', onResize\)/)
    assert.match(cleanupBody, /globeObserver\.disconnect\(\)/)
    assert.match(cleanupBody, /disposables\.forEach/)
    assert.match(cleanupBody, /renderer\.dispose\(\)/)
  })
})
