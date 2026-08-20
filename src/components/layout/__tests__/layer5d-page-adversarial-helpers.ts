import { mock } from 'node:test'
import assert from 'node:assert/strict'

/**
 * getSignals/getSignalsCount/getSourceLinksForSignals all throw if
 * called -- proves the real redirect() genuinely happens BEFORE any
 * data query, not after an already-executed (and wasted) fetch.
 */
export function mockQueriesThatMustNotBeCalled(): void {
  mock.module('@/modules/signals/queries', {
    namedExports: {
      getSignals: async () => {
        throw new Error('getSignals must not be called before the real redirect')
      },
      getSignalsCount: async () => {
        throw new Error('getSignalsCount must not be called before the real redirect')
      },
    },
  })
  mock.module('@/modules/observations/queries', {
    namedExports: {
      getSourceLinksForSignals: async () => {
        throw new Error('getSourceLinksForSignals must not be called before the real redirect')
      },
    },
  })
}

export async function assertCanonicalRedirect(
  searchParams: { category?: string; page?: string },
  expectedTargetFragment: string,
): Promise<void> {
  const { default: SignalsPage } = await import('../../../app/signals/page')
  await assert.rejects(
    () => SignalsPage({ searchParams: Promise.resolve(searchParams) }),
    (err: unknown) => {
      const digest = (err as { digest?: string }).digest ?? ''
      assert.match(
        digest,
        /^NEXT_REDIRECT;/,
        `real redirect() must fire for page=${searchParams.page}`,
      )
      assert.match(
        digest,
        new RegExp(`;${expectedTargetFragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')};`),
        `real redirect target for page=${searchParams.page} must be exactly ${expectedTargetFragment}`,
      )
      return true
    },
  )
}
