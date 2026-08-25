import * as Sentry from '@sentry/nextjs'

import { isSentryEnabled } from './sentry-config'
import { CONTROLLED_TEST_MESSAGE } from './sentry-privacy'

export interface ControlledSentryCaptureDeps {
  enabled: () => boolean
  captureException: (error: Error) => string
  flush: (timeout: number) => Promise<boolean>
}

const REAL_DEPS: ControlledSentryCaptureDeps = {
  enabled: isSentryEnabled,
  captureException: Sentry.captureException,
  flush: Sentry.flush,
}

export class ControlledSentryTestError extends Error {
  constructor() {
    super(CONTROLLED_TEST_MESSAGE)
    this.name = 'ControlledSentryTestError'
  }
}

export async function captureControlledSentryTestEvent(
  deps: ControlledSentryCaptureDeps = REAL_DEPS,
): Promise<'sent' | 'disabled' | 'flush_failed'> {
  if (!deps.enabled()) return 'disabled'
  deps.captureException(new ControlledSentryTestError())
  return (await deps.flush(2_000)) ? 'sent' : 'flush_failed'
}
