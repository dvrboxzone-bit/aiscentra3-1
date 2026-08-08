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
import { env } from '@/config/env'
import type { Signal, Event, Report } from '@/types/database'

export interface RetrievedContext {
  signals: Pick<
    Signal,
    'id' | 'title' | 'description' | 'category' | 'signal_score' | 'confidence_score' | 'created_at'
  >[]
  events: Pick<
    Event,
    'id' | 'title' | 'summary' | 'impact_summary' | 'forecast' | 'event_type' | 'timeline_date'
  >[]
  reports: Pick<Report, 'id' | 'title' | 'summary' | 'content' | 'report_type' | 'published_at'>[]
  hasContext: boolean
  contextSummary: string
}

function sanitise(q: string): string {
  return q
    .trim()
    .replace(/[<>'";\\]/g, '')
    .slice(0, 200)
}

export async function retrieveContext(userQuery: string): Promise<RetrievedContext> {
  const supabase = await createClient()
  const query = sanitise(userQuery)

  if (query.length < 2) {
    return {
      signals: [],
      events: [],
      reports: [],
      hasContext: false,
      contextSummary: 'Query too short to retrieve context.',
    }
  }

  // ── Detect category intent from query ──────────────────────────────────────
  const CATEGORY_KEYWORDS: Record<string, string> = {
    'model|llm|language model|gpt|claude|gemini|llama|mistral|benchmark.*model': 'MODELS',
    'paper|arxiv|study|research|algorithm|benchmark(?!.*agent)': 'RESEARCH',
    'fund|invest|raise|round|valuation|startup|acqui': 'FUNDING',
    'regulation|law|policy|govern|eu ai act|gdpr|compliance|safety.*regulation': 'REGULATION',
    'agent|agentic|autonomous|workflow|automat': 'AGENTS',
    'infrastructure|cloud|gpu|compute|hardware|chip|datacenter': 'INFRASTRUCTURE',
    'open.source|open.weight|apache|mit license': 'OPEN_SOURCE',
    'company|acquisition|merger|microsoft|google|meta|openai|anthropic|partnership': 'COMPANIES',
  }
  let categoryFilter: string | null = null
  const qLower = query.toLowerCase()
  for (const [pattern, cat] of Object.entries(CATEGORY_KEYWORDS)) {
    if (new RegExp(pattern).test(qLower)) {
      categoryFilter = cat
      break
    }
  }

  // ── Total signal count for context metadata ───────────────────────────────
  const { count: totalSignals } = await supabase
    .from('signals')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'ACTIVE')

  // ── FTS: description search, category-aware, limit 15 ────────────────────
  const sigBaseQuery = supabase
    .from('signals')
    .select('id, title, description, category, signal_score, confidence_score, created_at')
    .eq('status', 'ACTIVE')
  const sigBase = categoryFilter ? sigBaseQuery.eq('category', categoryFilter) : sigBaseQuery

  const [signalsFTS, eventsResult, reportsResult] = await Promise.all([
    sigBase
      .textSearch('description', query, { type: 'websearch', config: 'english' })
      .order('signal_score', { ascending: false })
      .limit(15),
    supabase
      .from('events')
      .select('id, title, summary, impact_summary, forecast, event_type, timeline_date')
      .textSearch('title', query, { type: 'websearch', config: 'english' })
      .order('impact_score', { ascending: false })
      .limit(5),
    supabase
      .from('reports')
      .select('id, title, summary, content, report_type, published_at')
      .not('published_at', 'is', null)
      .textSearch('title', query, { type: 'websearch', config: 'english' })
      .order('published_at', { ascending: false })
      .limit(3),
  ])

  let signals = (signalsFTS.data ?? []) as RetrievedContext['signals']
  const events = (eventsResult.data ?? []) as RetrievedContext['events']
  const reports = (reportsResult.data ?? []) as RetrievedContext['reports']

  // ── Fallback: category-aware top signals by score ─────────────────────────
  if (signals.length === 0) {
    const fallbackQuery = supabase
      .from('signals')
      .select('id, title, description, category, signal_score, confidence_score, created_at')
      .eq('status', 'ACTIVE')
      .order('signal_score', { ascending: false })
      .limit(10)
    const fallback = categoryFilter ? fallbackQuery.eq('category', categoryFilter) : fallbackQuery
    const { data } = await fallback
    signals = (data ?? []) as RetrievedContext['signals']
  }

  const total = totalSignals ?? 0
  const hasContext = signals.length > 0 || events.length > 0 || reports.length > 0

  const contextSummary = hasContext
    ? `Retrieved ${signals.length} signal(s) from ${total} total in Observatory. Events: ${events.length}. Reports: ${reports.length}.${categoryFilter ? ` Category filter: ${categoryFilter}.` : ''}`
    : `No relevant Observatory intelligence found. Observatory contains ${total} total signals.`

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
          `ID: ${s.id} | URL: ${env.APP_URL}/signals/${s.id}\n` +
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
          `ID: ${e.id} | URL: ${env.APP_URL}/events/${e.id}\n` +
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
          `ID: ${r.id} | URL: ${env.APP_URL}/reports/${r.id}\n` +
          `Published: ${(r.published_at ?? '').slice(0, 10)}\n` +
          `${r.summary}\n` +
          `${r.content.slice(0, 800)}\n`,
      )
    }
  }

  return parts.join('\n')
}
