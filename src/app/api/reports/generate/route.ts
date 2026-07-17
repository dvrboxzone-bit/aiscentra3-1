/**
 * AIscentra — Report Generation API
 *
 * POST /api/reports/generate
 * Body: one of:
 *   { type: 'SIGNAL_BRIEF',   signalId: string }
 *   { type: 'EVENT_ANALYSIS', eventId: string }
 *   { type: 'WEEKLY_REVIEW' }
 *   { type: 'TREND_REPORT',   category: string }
 */
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import {
  generateSignalBrief,
  generateEventAnalysis,
  generateWeeklyReview,
  generateTrendReport,
} from '@/modules/reports/engine'
import type { Signal, Event, SignalCategory } from '@/types/database'

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

  const body = (await request.json()) as {
    type: string
    signalId?: string
    eventId?: string
    category?: string
  }

  const supabase = createAdminClient()

  switch (body.type) {
    case 'SIGNAL_BRIEF': {
      if (!body.signalId) {
        return NextResponse.json({ error: 'signalId required' }, { status: 400 })
      }
      const { data } = await supabase.from('signals').select('*').eq('id', body.signalId).single()
      if (!data) return NextResponse.json({ error: 'Signal not found' }, { status: 404 })
      const result = await generateSignalBrief(data as Signal)
      return NextResponse.json(result)
    }

    case 'EVENT_ANALYSIS': {
      if (!body.eventId) {
        return NextResponse.json({ error: 'eventId required' }, { status: 400 })
      }
      const { data } = await supabase.from('events').select('*').eq('id', body.eventId).single()
      if (!data) return NextResponse.json({ error: 'Event not found' }, { status: 404 })
      const result = await generateEventAnalysis(data as Event)
      return NextResponse.json(result)
    }

    case 'WEEKLY_REVIEW': {
      const result = await generateWeeklyReview()
      return NextResponse.json(result)
    }

    case 'TREND_REPORT': {
      if (!body.category) {
        return NextResponse.json({ error: 'category required' }, { status: 400 })
      }
      const result = await generateTrendReport(body.category as SignalCategory)
      return NextResponse.json(result)
    }

    default:
      return NextResponse.json({ error: `Unknown report type: ${body.type}` }, { status: 400 })
  }
}
