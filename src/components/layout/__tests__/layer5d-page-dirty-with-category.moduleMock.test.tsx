import '../../../lib/test-utils/dom-setup'

import { test, describe } from 'node:test'
import { forceReducedMotion } from '../../../app/__tests__/homepage-fixtures'
import {
  mockQueriesThatMustNotBeCalled,
  assertCanonicalRedirect,
} from './layer5d-page-adversarial-helpers'

describe('/signals — dirty page with an active category preserves the real category through canonicalization', () => {
  test('page=2abc with category=INFRASTRUCTURE redirects to /signals?category=INFRASTRUCTURE, real category preserved, dirty page dropped', async (t) => {
    const restore = forceReducedMotion()
    t.after(restore)
    mockQueriesThatMustNotBeCalled()
    await assertCanonicalRedirect(
      { category: 'INFRASTRUCTURE', page: '2abc' },
      '/signals?category=INFRASTRUCTURE',
    )
  })
})
