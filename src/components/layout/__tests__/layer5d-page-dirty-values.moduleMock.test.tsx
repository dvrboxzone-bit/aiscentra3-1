import '../../../lib/test-utils/dom-setup'

import { test, describe } from 'node:test'
import { forceReducedMotion } from '../../../app/__tests__/homepage-fixtures'
import {
  mockQueriesThatMustNotBeCalled,
  assertCanonicalRedirect,
} from './layer5d-page-adversarial-helpers'

describe('/signals — every dirty page value redirects to the real canonical /signals, before any query runs', () => {
  test('2.5, 2abc, 3e2, 0, negative, whitespace, leading-zero, empty, and other dirty forms all redirect with the real NEXT_REDIRECT digest', async (t) => {
    const restore = forceReducedMotion()
    t.after(restore)
    mockQueriesThatMustNotBeCalled()

    const dirtyValues = ['2.5', '2abc', '3e2', '0', '-3', ' 2 ', '01', '', '2 ', ' 2', '+2', '2.0']
    for (const dirty of dirtyValues) {
      await assertCanonicalRedirect({ page: dirty }, '/signals')
    }
  })
})
