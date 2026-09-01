import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe("checkpoint 5A files — no forbidden URLs anywhere in the new pages' own source", () => {
  test('no page in this checkpoint contains a literal Picsum, z-cdn, or signed-URL reference in its own source text', () => {
    for (const rel of [
      '(public)/about/page.tsx',
      '(public)/signals/page.tsx',
      '(public)/signals/[slug]/page.tsx',
    ]) {
      const src = readFileSync(join(__dirname, '..', '..', '..', 'app', rel), 'utf-8')
      assert.doesNotMatch(src, /picsum/i, `${rel} must not reference Picsum`)
      assert.doesNotMatch(src, /z-cdn/i, `${rel} must not reference z-cdn`)
    }
  })
})
