import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

function source(relativePath: string): string {
  return readFileSync(join(__dirname, '..', '..', '..', relativePath), 'utf-8')
}

describe('public route correction contracts', () => {
  test('event and report detail pages render dynamically when cookie-bound data is read', () => {
    for (const path of ['app/events/[slug]/page.tsx', 'app/reports/[slug]/page.tsx']) {
      const file = source(path)
      assert.match(file, /export const dynamic = ['"]force-dynamic['"]/)
      assert.doesNotMatch(file, /export const revalidate/)
    }
  })

  test('all Framework anchors reserve the fixed-header offset', () => {
    const css = source('app/globals.css')
    for (const anchor of ['epistemic-model', 'methodology', 'security-data', 'roadmap']) {
      assert.match(css, new RegExp(`#${anchor}`))
    }
    assert.match(css, /scroll-margin-top:\s*100px/)
  })
})
