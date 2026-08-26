import { NextResponse } from 'next/server'

import { captureControlledSentryTestEvent } from '@/lib/observability/sentry-control'
import { isAuthorizedCronRequest } from '@/lib/security/cron-guard'

export const dynamic = 'force-dynamic'

export interface SentryTestRouteDeps {
  capture: () => Promise<'sent' | 'disabled' | 'flush_failed'>
  environment: () => string | undefined
  authorize: (request: Request) => boolean
}

const REAL_DEPS: SentryTestRouteDeps = {
  capture: captureControlledSentryTestEvent,
  environment: () => process.env['VERCEL_ENV'],
  authorize: isAuthorizedCronRequest,
}

export async function handleControlledSentryTest(
  request: Request,
  deps: SentryTestRouteDeps = REAL_DEPS,
): Promise<NextResponse> {
  if (deps.environment() !== 'preview') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  if (!deps.authorize(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(request.url)
  const contentLength = request.headers.get('content-length')
  if (url.search !== '' || (contentLength !== null && contentLength !== '0')) {
    return NextResponse.json({ error: 'This control accepts no input' }, { status: 400 })
  }

  const outcome = await deps.capture()
  if (outcome === 'sent') return NextResponse.json({ sent: true }, { status: 202 })
  if (outcome === 'disabled') {
    return NextResponse.json({ sent: false, reason: 'sentry_disabled' }, { status: 503 })
  }
  return NextResponse.json({ sent: false, reason: 'flush_failed' }, { status: 503 })
}

export async function POST(request: Request): Promise<NextResponse> {
  return handleControlledSentryTest(request)
}
