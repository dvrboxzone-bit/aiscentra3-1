/**
 * AIscentra — Enrichment API
 *
 * POST /api/enrich
 * Body: { observationId?: string } — specific observation, or next unprocessed
 *
 * Processes ONE observation per call to stay within Vercel 10s timeout.
 * The Signal Engine (one AI call) typically completes in 3–6 seconds.
 *
 * Called by: /api/cron/enrich (scheduled after collection)
 */
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { processObservation } from '@/modules/signals/engine'
import { markObservationProcessed } from '@/modules/observations/queries'
import type { ObservationRow } from '@/modules/observations/queries'

export const maxDuration = 10
export const dynamic = 'force-dynamic'

function isAuthorized(request: Request): boolean {
  const secret = process.env['CRON_SECRET']
  if (!secret) return false
  const header = request.headers.get('x-cron-secret') ?? request.headers.get('authorization')
  return header === secret || header === `Bearer ${secret}`
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { observationId?: string } = {}
  try {
    body = (await request.json()) as { observationId?: string }
  } catch {
    // Empty body = pick next unprocessed
  }

  const supabase = createAdminClient()

  // Fetch the target observation
  let observation: ObservationRow | null = null

  if (body.observationId) {
    const { data } = await supabase
      .from('observations')
      .select('*')
      .eq('id', body.observationId)
      .single()
    observation = data as ObservationRow | null
  } else {
    // Pick the oldest unprocessed observation
    const { data } = await supabase
      .from('observations')
      .select('*')
      .eq('processed', false)
      .is('processing_error', null)
      .order('collected_at', { ascending: true })
      .limit(1)
      .single()
    observation = data as ObservationRow | null
  }

  if (!observation) {
    return NextResponse.json({ message: 'No unprocessed observations found' })
  }

  // Fetch source metadata for trust_score and name
  const { data: source } = await supabase
    .from('sources')
    .select('trust_score, name')
    .eq('id', observation.source_id)
    .single()

  const trustScore = (source?.trust_score as number | undefined) ?? 0.5
  const sourceName = (source?.name as string | undefined) ?? 'Unknown Source'

  // Process the observation through the Signal Engine
  const result = await processObservation(observation, trustScore, sourceName)

  // Mark observation as processed (success or failure)
  await markObservationProcessed(
    observation.id,
    result.signalId ?? null,
    result.outcome === 'error' ? result.reason : undefined,
  )

  // Log result for monitoring
  console.log(`[enrich] obs=${observation.id} outcome=${result.outcome}`, result.scores ?? result.reason ?? '')

  return NextResponse.json(result)
}
