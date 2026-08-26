import * as Sentry from '@sentry/nextjs'

import { getSentryErrorOnlyOptions, isSentryEnabled } from './src/lib/observability/sentry-config'

if (isSentryEnabled()) {
  Sentry.init(getSentryErrorOnlyOptions())
}
