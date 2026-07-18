/**
 * AIscentra — Assistant Retrieval Layer
 *
 * Retrieves relevant Observatory knowledge for a user query.
 * The Assistant only responds from this retrieved context — never from
 * general AI training knowledge (ISA Skill v1.0, Section 07.3).
 *
 * Retrieval strategy (MVP):
 * 1. Full-text search signals
 * 2. Full-text search events
 * 3. Full-text search reports
 * 4. Recent high-score signals as baseline context
 */
import { createClient } from '@/lib/supabase/server'
import type { Signal, Event, Report } from '@/types/database'

export interface RetrievedContext {
  signals: Pick<Signal, 'id' | 'title' | 'description' | 'category' | 'signal_score' | 'confidence_score' | 'created_at'>[]
  events:  Pick<Event,  'id' | 'title' | 'summary' | 'impact_summary' | 'forecast' | 'event_type' | 'timeline_date'>[]
  reports: Pick<Report, 'id' | 'title' | 'summary' | 'content' | 'report_type' | 'published_at'>[]
  hasContext: boolean
  contextSummary: string
}

function sanitise(q: string): string {
  return q.trim().replace(/[<>'";\\]/g, '').slice(0, 200)
}

export async function retrieveContext(userQuery: string): Promise<RetrievedContext> {
  const supabase = await createClient()
  const query    = sanitise(userQuery)

  if (query.length < 2) {
    return {
      signals: [], events: [], reports: [],
      hasContext: false,
      contextSummary: 'Query too short to retrieve context.',
    }
  }

  // Parallel retrieval across all three intelligence layers
  const [signalsResult, eventsResult, reportsResult, recentResult] = await Promise.all([
    // FTS search signals
    supabase
      .from('signals')
      .select('id, title, description, category, signal_score, confidence_score, created_at')
      .eq('status', 'ACTIVE')
      .textSearch('title', query, { type: 'websearch', config: 'english' })
      .order('signal_score', { ascending: false })
      .limit(5),

    // FTS search events
    supabase
      .from('events')
      .select('id, title, summary, impact_summary, forecast, event_type, timeline_date')
      .textSearch('title', query, { type: 'websearch', config: 'english' })
      .order('impact_score', { ascending: false })
      .limit(3),

    // FTS search reports
    supabase
      .from('reports')
      .select('id, title, summary, content, report_type, published_at')
      .not('published_at', 'is', null)
      .textSearch('title', query, { type: 'websearch', config: 'english' })
      .order('published_at', { ascending: false })
      .limit(2),

    // Fallback: recent high-score signals if FTS returns nothing
    supabase
      .from('signals')
      .select('id, title, description, category, signal_score, confidence_score, created_at')
      .eq('status', 'ACTIVE')
      .order('signal_score', { ascending: false })
      .limit(3),
  ])

  let signals = (signalsResult.data ?? []) as RetrievedContext['signals']
  const events  = (eventsResult.data  ?? []) as RetrievedContext['events']
  const reports = (reportsResult.data ?? []) as RetrievedContext['reports']

  // If FTS found nothing for signals, use recent high-score as baseline
  if (signals.length === 0) {
    signals = (recentResult.data ?? []) as RetrievedContext['signals']
  }

  const hasContext = signals.length > 0 || events.length > 0 || reports.length > 0

  const contextSummary = hasContext
    ? `Retrieved ${signals.length} signal(s), ${events.length} event(s), ${reports.length} report(s) from Observatory knowledge base.`
    : 'No relevant Observatory intelligence found for this query.'

  return { signals, events, reports, hasContext, contextSummary }
}

// ── Format Context for Prompt ──────────────────────────────────────────────────

export function formatContextForPrompt(ctx: RetrievedContext): string {
  if (!ctx.hasContext) {
    return 'No relevant Observatory intelligence found.'
  }

  const parts: string[] = []

  if (ctx.signals.length > 0) {
    parts.push('=== OBSERVATORY SIGNALS ===')
    for (const s of ctx.signals) {
      parts.push(
        `[SIGNAL] ${s.title}\n` +
        `Category: ${s.category} | Score: ${s.signal_score}/100 | Confidence: ${s.confidence_score}%\n` +
        `Date: ${s.created_at.slice(0, 10)}\n` +
        `${s.description}\n`,
      )
    }
  }

  if (ctx.events.length > 0) {
    parts.push('=== OBSERVATORY EVENTS ===')
    for (const e of ctx.events) {
      parts.push(
        `[EVENT] ${e.title}\n` +
        `Type: ${e.event_type} | Timeline: ${e.timeline_date}\n` +
        `Summary: ${e.summary}\n` +
        `Impact: ${e.impact_summary}\n` +
        `Forecast: ${e.forecast}\n`,
      )
    }
  }

  if (ctx.reports.length > 0) {
    parts.push('=== OBSERVATORY REPORTS ===')
    for (const r of ctx.reports) {
      parts.push(
        `[REPORT: ${r.report_type}] ${r.title}\n` +
        `Published: ${(r.published_at ?? '').slice(0, 10)}\n` +
        `${r.summary}\n` +
        `${r.content.slice(0, 800)}\n`,
      )
    }
  }

  return parts.join('\n')
}
