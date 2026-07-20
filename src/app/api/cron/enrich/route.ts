/**
 * AIscentra — Cron: Signal Enrichment
 *
 * GET /api/cron/enrich
 * Triggered by Vercel Cron every 4 hours, 30 minutes after collection.
 * Schedule: 30 *\/4 * * * (30 mins after collection at 0 /4 * * *)
 *
 * Pattern: fetches IDs of unprocessed observations, fires one
 * /api/enrich call per observation (non-blocking).
 * Each enrichment call = one AI call = stays within 10s timeout.
 */
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export const maxDuration = 10
export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<NextResponse> {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env['CRON_SECRET']}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase  = createAdminClient()
  const appUrl    = process.env['NEXT_PUBLIC_APP_URL'] ?? 'https://aiscentra.com'
  const cronSecret = process.env['CRON_SECRET'] ?? ''

  // Fetch unprocessed observation IDs (limit 50 per cron run)
  const { data: observations, error } = await supabase
    .from('observations')
    .select('id')
    .eq('processed', false)
    .is('processing_error', null)
    .order('collected_at', { ascending: true })
    .limit(50)
    .returns<{ id: string }[]>()

  if (error) {
    console.error('[cron/enrich] Failed to fetch observations:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!observations || observations.length === 0) {
    return NextResponse.json({ message: 'No unprocessed observations', triggered: 0 })
  }

  // Fire enrichment per observation — non-blocking
  let triggered = 0
  for (const obs of observations) {
    fetch(`${appUrl}/api/enrich`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'x-cron-secret': cronSecret,
      },
      body: JSON.stringify({ observationId: obs.id }),
    }).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[cron/enrich] Failed to trigger obs ${obs.id as string}:`, msg)
    })
    triggered++
  }

  console.log(`[cron/enrich] Triggered enrichment for ${triggered} observations`)

  return NextResponse.json({
    triggered,
    timestamp: new Date().toISOString(),
  })
}
