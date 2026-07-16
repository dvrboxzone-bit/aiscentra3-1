/**
 * AIscentra — Health Check API
 * GET /api/health
 */
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<NextResponse> {
  const timestamp = new Date().toISOString()

  try {
    const supabase = createAdminClient()

    const [sources, observations, signals, events] = await Promise.all([
      supabase.from('sources').select('id', { count: 'exact', head: true }),
      supabase.from('observations').select('id', { count: 'exact', head: true }),
      supabase.from('signals').select('id', { count: 'exact', head: true }),
      supabase.from('events').select('id', { count: 'exact', head: true }),
    ])

    const dbError = sources.error ?? observations.error ?? signals.error ?? events.error
    if (dbError && !dbError.code?.startsWith('PGRST')) {
      return NextResponse.json({ status: 'error', timestamp, error: dbError.message }, { status: 503 })
    }

    // Pipeline-specific counts
    const [unprocessed, active, errors24h] = await Promise.all([
      supabase.from('observations').select('id', { count: 'exact', head: true }).eq('processed', false),
      supabase.from('signals').select('id', { count: 'exact', head: true }).eq('status', 'ACTIVE'),
      supabase.from('observations').select('id', { count: 'exact', head: true })
        .not('processing_error', 'is', null)
        .gte('created_at', new Date(Date.now() - 86400000).toISOString()),
    ])

    return NextResponse.json({
      status:    'ok',
      timestamp,
      version:   '0.1.0',
      checks: {
        database:     'ok',
        sources:      sources.count      ?? 0,
        observations: observations.count ?? 0,
        signals:      signals.count      ?? 0,
        events:       events.count       ?? 0,
        pipeline: {
          unprocessed_observations: unprocessed.count ?? 0,
          active_signals:           active.count      ?? 0,
          errors_24h:               errors24h.count   ?? 0,
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
