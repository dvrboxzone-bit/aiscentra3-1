import { access } from 'node:fs/promises'
import path from 'node:path'
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { LANDING_ASSETS } from '../vfinal-landing-assets'

describe('vfinal landing asset map', () => {
  test('contains every approved WebP exactly once and every path exists in public', async () => {
    assert.equal(LANDING_ASSETS.length, 43)
    assert.equal(new Set(LANDING_ASSETS.map((asset) => asset.src)).size, LANDING_ASSETS.length)

    await Promise.all(
      LANDING_ASSETS.map(async (asset) => {
        assert.match(asset.src, /^\/images\/.+\.webp$/)
        assert.ok(asset.alt.trim())
        assert.ok(asset.purpose)
        await access(path.join(process.cwd(), 'public', asset.src))
      }),
    )
  })
})
