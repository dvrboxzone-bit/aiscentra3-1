/**
 * AIscentra — Report Engine
 *
 * Generates intelligence reports from signals and events.
 * Four report types per MVP Specification v1.0.
 *
 * Reports are immutable after publication.
 * Intelligence Evolution Framework v1.0, Section 10.2:
 * "Reports are permanently archived. Never edited after publication."
 */
import { agentCompleteJSON } from '@/lib/ai/agent'
import { createAdminClient } from '@/lib/supabase/server'
import {
  ReportOutputSchema,
  REPORT_SYSTEM_PROMPT,
  buildSignalBriefPrompt,
  buildEventAnalysisPrompt,
  buildWeeklyReviewPrompt,
  buildTrendReportPrompt,
} from './report-prompt'
import type { Signal, Event, ReportType, SignalCategory } from '@/types/database'

export interface ReportResult {
  outcome: 'created' | 'skipped' | 'error'
  reportId?: string
  reportType?: ReportType
  reason?: string
}

// ── Signal Brief ──────────────────────────────────────────────────────────────

export async function generateSignalBrief(signal: Signal): Promise<ReportResult> {
  const supabase = createAdminClient()

  // Check if brief already exists for this signal
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing } = await (supabase as any)
    .from('reports')
    .select('id')
    .contains('signal_ids', [signal.id])
    .eq('report_type', 'SIGNAL_BRIEF')
    .single()

  if (existing?.id) {
    return { outcome: 'skipped', reason: 'Brief already exists for this signal' }
  }

  let output
  try {
    output = await agentCompleteJSON('writer', 
      [
        { role: 'system', content: REPORT_SYSTEM_PROMPT },
        { role: 'user',   content: buildSignalBriefPrompt(signal) },
      ],
      ReportOutputSchema,
      { temperature: 0, maxTokens: 1500 },
    )
  } catch (err) {
    return { outcome: 'error', reason: err instanceof Error ? err.message : 'Enrichment failed' }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: report, error } = await (supabase as any)
    .from('reports')
    .insert({
      title:        output.title,
      summary:      output.summary,
      content:      output.content,
      report_type:  'SIGNAL_BRIEF',
      signal_ids:   [signal.id],
      event_ids:    [],
      published_at: new Date().toISOString(),
      metadata: {
        generation_model: process.env['OPENROUTER_MODEL'] ?? 'anthropic/claude-haiku-4-5',
        generated_at:     new Date().toISOString(),
      },
    })
    .select('id')
    .single()

  if (error || !report?.id) {
    return { outcome: 'error', reason: `Insert failed: ${error?.message ?? 'unknown'}` }
  }

  return { outcome: 'created', reportId: report.id as string, reportType: 'SIGNAL_BRIEF' }
}

// ── Event Analysis ────────────────────────────────────────────────────────────

export async function generateEventAnalysis(event: Event): Promise<ReportResult> {
  const supabase = createAdminClient()

  // Check if analysis already exists for this event
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing } = await (supabase as any)
    .from('reports')
    .select('id')
    .contains('event_ids', [event.id])
    .eq('report_type', 'EVENT_ANALYSIS')
    .single()

  if (existing?.id) {
    return { outcome: 'skipped', reason: 'Analysis already exists for this event' }
  }

  // Fetch origin signal for context
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: signalData } = await (supabase as any)
    .from('signals')
    .select('*')
    .eq('id', event.signal_id)
    .single()
  const signal = signalData as Signal | null

  let output
  try {
    output = await agentCompleteJSON('writer', 
      [
        { role: 'system', content: REPORT_SYSTEM_PROMPT },
        { role: 'user',   content: buildEventAnalysisPrompt(event, signal) },
      ],
      ReportOutputSchema,
      { temperature: 0, maxTokens: 2000 },
    )
  } catch (err) {
    return { outcome: 'error', reason: err instanceof Error ? err.message : 'Enrichment failed' }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: report, error } = await (supabase as any)
    .from('reports')
    .insert({
      title:        output.title,
      summary:      output.summary,
      content:      output.content,
      report_type:  'EVENT_ANALYSIS',
      signal_ids:   signal ? [signal.id] : [],
      event_ids:    [event.id],
      published_at: new Date().toISOString(),
      metadata: {
        generation_model: process.env['OPENROUTER_MODEL'] ?? 'anthropic/claude-haiku-4-5',
        generated_at:     new Date().toISOString(),
      },
    })
    .select('id')
    .single()

  if (error || !report?.id) {
    return { outcome: 'error', reason: `Insert failed: ${error?.message ?? 'unknown'}` }
  }

  return { outcome: 'created', reportId: report.id as string, reportType: 'EVENT_ANALYSIS' }
}

// ── Weekly Review ─────────────────────────────────────────────────────────────

export async function generateWeeklyReview(): Promise<ReportResult> {
  const supabase  = createAdminClient()
  const weekEnd   = new Date()
  const weekStart = new Date(weekEnd.getTime() - 7 * 86400000)

  const weekStartStr = weekStart.toISOString().slice(0, 10)
  const weekEndStr   = weekEnd.toISOString().slice(0, 10)

  // Check if weekly review already exists for this week
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing } = await (supabase as any)
    .from('reports')
    .select('id')
    .eq('report_type', 'WEEKLY_REVIEW')
    .gte('published_at', weekStart.toISOString())
    .single()

  if (existing?.id) {
    return { outcome: 'skipped', reason: 'Weekly review already exists for this week' }
  }

  // Fetch this week's events and signals
  const [eventsRes, signalsRes] = await Promise.all([
    supabase
      .from('events')
      .select('*')
      .gte('created_at', weekStart.toISOString())
      .order('impact_score', { ascending: false })
      .limit(10),
    supabase
      .from('signals')
      .select('*')
      .eq('status', 'ACTIVE')
      .gte('created_at', weekStart.toISOString())
      .order('signal_score', { ascending: false })
      .limit(10),
  ])

  const events  = (eventsRes.data  ?? []) as Event[]
  const signals = (signalsRes.data ?? []) as Signal[]

  // Need at least some data to generate a meaningful review
  if (events.length === 0 && signals.length === 0) {
    return { outcome: 'skipped', reason: 'No events or signals this week' }
  }

  let output
  try {
    output = await agentCompleteJSON('writer', 
      [
        { role: 'system', content: REPORT_SYSTEM_PROMPT },
        { role: 'user',   content: buildWeeklyReviewPrompt(events, signals, weekStartStr, weekEndStr) },
      ],
      ReportOutputSchema,
      { temperature: 0, maxTokens: 2500 },
    )
  } catch (err) {
    return { outcome: 'error', reason: err instanceof Error ? err.message : 'Enrichment failed' }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: report, error } = await (supabase as any)
    .from('reports')
    .insert({
      title:        output.title,
      summary:      output.summary,
      content:      output.content,
      report_type:  'WEEKLY_REVIEW',
      signal_ids:   signals.map((s) => s.id),
      event_ids:    events.map((e)  => e.id),
      published_at: new Date().toISOString(),
      metadata: {
        generation_model: process.env['OPENROUTER_MODEL'] ?? 'anthropic/claude-haiku-4-5',
        generated_at:     new Date().toISOString(),
        week_start:       weekStartStr,
        week_end:         weekEndStr,
      },
    })
    .select('id')
    .single()

  if (error || !report?.id) {
    return { outcome: 'error', reason: `Insert failed: ${error?.message ?? 'unknown'}` }
  }

  return { outcome: 'created', reportId: report.id as string, reportType: 'WEEKLY_REVIEW' }
}

// ── Trend Report ──────────────────────────────────────────────────────────────

export async function generateTrendReport(category: SignalCategory): Promise<ReportResult> {
  const supabase = createAdminClient()
  const since30d = new Date(Date.now() - 30 * 86400000).toISOString()
  const period   = 'Last 30 Days'

  // Check if trend report exists for this category this month
  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing } = await (supabase as any)
    .from('reports')
    .select('id')
    .eq('report_type', 'TREND_REPORT')
    .gte('published_at', monthStart.toISOString())
    // Use title prefix check as proxy for category
    .ilike('title', `%${category}%`)
    .single()

  if (existing?.id) {
    return { outcome: 'skipped', reason: `Trend report already exists for ${category} this month` }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: signalsData } = await (supabase as any)
    .from('signals')
    .select('*')
    .eq('category', category)
    .in('status', ['ACTIVE', 'PROMOTED', 'EXPIRED'])
    .gte('created_at', since30d)
    .order('signal_score', { ascending: false })
    .limit(20)

  const signals = (signalsData ?? []) as Signal[]

  if (signals.length < 3) {
    return { outcome: 'skipped', reason: `Insufficient signals in ${category} for trend analysis (need 3+)` }
  }

  let output
  try {
    output = await agentCompleteJSON('writer', 
      [
        { role: 'system', content: REPORT_SYSTEM_PROMPT },
        { role: 'user',   content: buildTrendReportPrompt(signals, category, period) },
      ],
      ReportOutputSchema,
      { temperature: 0, maxTokens: 2000 },
    )
  } catch (err) {
    return { outcome: 'error', reason: err instanceof Error ? err.message : 'Enrichment failed' }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: report, error } = await (supabase as any)
    .from('reports')
    .insert({
      title:        output.title,
      summary:      output.summary,
      content:      output.content,
      report_type:  'TREND_REPORT',
      signal_ids:   signals.map((s) => s.id),
      event_ids:    [],
      published_at: new Date().toISOString(),
      metadata: {
        generation_model: process.env['OPENROUTER_MODEL'] ?? 'anthropic/claude-haiku-4-5',
        generated_at:     new Date().toISOString(),
        category,
        period,
      },
    })
    .select('id')
    .single()

  if (error || !report?.id) {
    return { outcome: 'error', reason: `Insert failed: ${error?.message ?? 'unknown'}` }
  }

  return { outcome: 'created', reportId: report.id as string, reportType: 'TREND_REPORT' }
}
