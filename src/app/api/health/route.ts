/**
 * AIscentra — Health Check API
 * GET /api/health — system status, DB connectivity, observation pipeline state
 */
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<NextResponse> {
  const timestamp = new Date().toISOString()

  try {
    const supabase = createAdminClient()

    const [sources, signals, events, observations] = await Promise.all([
      supabase.from('sources').select('id', { count: 'exact', head: true }),
      supabase.from('signals').select('id', { count: 'exact', head: true }),
      supabase.from('events').select('id', { count: 'exact', head: true }),
      supabase.from('observations').select('id', { count: 'exact', head: true }),
    ])

    const dbError = sources.error ?? signals.error ?? events.error ?? observations.error
    if (dbError && !dbError.code?.startsWith('PGRST')) {
      return NextResponse.json(
        { status: 'error', timestamp, error: dbError.message },
        { status: 503 },
      )
    }

    // Check for unprocessed observations (pipeline health indicator)
    const { count: unprocessed } = await supabase
      .from('observations')
      .select('id', { count: 'exact', head: true })
      .eq('processed', false)

    return NextResponse.json({
      status: 'ok',
      timestamp,
      version: '0.1.0',
      checks: {
        database:     'ok',
        sources:      sources.count      ?? 0,
        observations: observations.count ?? 0,
        signals:      signals.count      ?? 0,
        events:       events.count       ?? 0,
        pipeline: {
          unprocessed: unprocessed ?? 0,
          status: (unprocessed ?? 0) > 50 ? 'backlogged' : 'healthy',
        },
      },
    })
  } catch (err) {
    return NextResponse.json(
      { status: 'error', timestamp, error: err instanceof Error ? err.message : 'Unknown' },
      { status: 503 },
    )
  }
}
