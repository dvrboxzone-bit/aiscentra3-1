import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { isValidSignalSlug } from '../../../app/signals/[slug]/page'

describe('/signals/[slug] UUID boundary', () => {
  test('accepts UUIDs and rejects malformed slugs before data access', () => {
    assert.equal(isValidSignalSlug('11111111-1111-4111-8111-111111111111'), true)
    assert.equal(isValidSignalSlug('not-a-uuid'), false)
    assert.equal(isValidSignalSlug('11111111-1111-1111-1111-111111111111'), false)
  })
})
