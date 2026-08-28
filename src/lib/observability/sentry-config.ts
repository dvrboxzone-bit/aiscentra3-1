import type * as Sentry from '@sentry/nextjs'

import {
  dropSentryBreadcrumb,
  dropSentryTransaction,
  removeDataAndTracingIntegrations,
  sanitizeSentryEvent,
} from './sentry-privacy'

function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim()
  if (!value) return undefined
  return value
}

export function getSentryDsn(): string | undefined {
  return optionalEnv('NEXT_PUBLIC_SENTRY_DSN')
}

export function isSentryEnabled(): boolean {
  return getSentryDsn() !== undefined
}

export function getSentryRelease(): string | undefined {
  return (
    optionalEnv('NEXT_PUBLIC_SENTRY_RELEASE') ??
    optionalEnv('VERCEL_GIT_COMMIT_SHA') ??
    optionalEnv('GITHUB_SHA')
  )
}

export function getSentryEnvironment(): string {
  return (
    optionalEnv('NEXT_PUBLIC_SENTRY_ENVIRONMENT') ??
    optionalEnv('NEXT_PUBLIC_VERCEL_ENV') ??
    optionalEnv('VERCEL_ENV') ??
    optionalEnv('NODE_ENV') ??
    'development'
  )
}

export function getSentryErrorOnlyOptions(): Parameters<typeof Sentry.init>[0] {
  return {
    dsn: getSentryDsn(),
    enabled: isSentryEnabled(),
    release: getSentryRelease(),
    environment: getSentryEnvironment(),
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend: sanitizeSentryEvent,
    beforeSendTransaction: dropSentryTransaction,
    beforeBreadcrumb: dropSentryBreadcrumb,
    integrations: removeDataAndTracingIntegrations,
    enableLogs: false,
  }
}
