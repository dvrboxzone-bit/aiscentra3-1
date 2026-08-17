import '../../../lib/test-utils/dom-setup'

import { test, describe } from 'node:test'
import { forceReducedMotion } from '../../../app/__tests__/homepage-fixtures'
import {
  mockQueriesThatMustNotBeCalled,
  assertCanonicalRedirect,
} from './layer5d-page-adversarial-helpers'

describe('/signals — explicit page=1 with an active category drops the page, keeps the category', () => {
  test('page=1 with category=HARDWARE redirects to /signals?category=HARDWARE (page dropped, category kept)', async (t) => {
    const restore = forceReducedMotion()
    t.after(restore)
    mockQueriesThatMustNotBeCalled()
    await assertCanonicalRedirect({ category: 'HARDWARE', page: '1' }, '/signals?category=HARDWARE')
  })
})
