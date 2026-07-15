/**
 * AIscentra — Health Check API
 *
 * GET /api/health
 * Returns system status and Supabase connectivity.
 * Used for monitoring and verifying deployments.
 */
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

interface HealthResponse {
  status: 'ok' | 'degraded' | 'error'
  timestamp: string
  version: string
  checks: {
    database: 'ok' | 'error'
    sources: number
    signals: number
    events: number
  }
  error?: string
}

export async function GET(): Promise<NextResponse<HealthResponse>> {
  const timestamp = new Date().toISOString()
  const version = process.env['npm_package_version'] ?? '0.1.0'

  try {
    const supabase = createAdminClient()

    // Run parallel count queries — fastest way to verify connectivity and data
    const [sourcesResult, signalsResult, eventsResult] = await Promise.all([
      supabase.from('sources').select('id', { count: 'exact', head: true }),
      supabase.from('signals').select('id', { count: 'exact', head: true }),
      supabase.from('events').select('id', { count: 'exact', head: true }),
    ])

    // If any query has a non-PGRST error, database is not reachable
    const dbError = sourcesResult.error ?? signalsResult.error ?? eventsResult.error
    if (dbError && !dbError.code?.startsWith('PGRST')) {
      return NextResponse.json(
        {
          status: 'error',
          timestamp,
          version,
          checks: { database: 'error', sources: 0, signals: 0, events: 0 },
          error: dbError.message,
        },
        { status: 503 },
      )
    }

    return NextResponse.json({
      status: 'ok',
      timestamp,
      version,
      checks: {
        database: 'ok',
        sources: sourcesResult.count ?? 0,
        signals: signalsResult.count ?? 0,
        events:  eventsResult.count ?? 0,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json(
      {
        status: 'error',
        timestamp,
        version,
        checks: { database: 'error', sources: 0, signals: 0, events: 0 },
        error: message,
      },
      { status: 503 },
    )
  }
}
