import '../../../lib/test-utils/dom-setup'

import { test, describe } from 'node:test'
import { forceReducedMotion } from '../../../app/__tests__/homepage-fixtures'
import {
  mockQueriesThatMustNotBeCalled,
  assertCanonicalRedirect,
} from './layer5d-page-adversarial-helpers'

describe('/signals — explicit page=1 is redundant and is genuinely stripped from the URL', () => {
  test('page=1 redirects to the bare /signals, never kept as a redundant param', async (t) => {
    const restore = forceReducedMotion()
    t.after(restore)
    mockQueriesThatMustNotBeCalled()
    await assertCanonicalRedirect({ page: '1' }, '/signals')
  })
})
