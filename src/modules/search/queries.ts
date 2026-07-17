/**
 * AIscentra — Search Queries
 *
 * Full-text search across signals, events, and reports.
 * Uses Postgres FTS via Supabase — GIN indexes created in migrations 004, 006, 007.
 *
 * Stage 11: Build Order v1.0
 * Enables: discovery of Observatory intelligence by topic or entity.
 */
import { createClient } from '@/lib/supabase/server'
import type { Signal, Event, Report, SignalCategory } from '@/types/database'
import { getSignalSeverity } from '@/types/database'

export interface SearchResult {
  id:        string
  type:      'signal' | 'event' | 'report'
  title:     string
  summary:   string
  category?: SignalCategory
  score?:    number
  severity?: string
  href:      string
  date:      string
}

export interface SearchResults {
  signals: SearchResult[]
  events:  SearchResult[]
  reports: SearchResult[]
  total:   number
  query:   string
}

// ── Sanitise query ────────────────────────────────────────────────────────────

function sanitiseQuery(raw: string): string {
  return raw
    .trim()
    .replace(/[<>'";\\]/g, '')   // strip injection chars
    .slice(0, 100)               // max length
}

function toTsQuery(query: string): string {
  // Convert plain text to Postgres tsquery format
  // "open source models" → "open & source & models"
  return query
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .map((w) => w.replace(/[^a-zA-Z0-9]/g, ''))
    .filter(Boolean)
    .join(' & ')
}

// ── Search Signals ─────────────────────────────────────────────────────────────

async function searchSignals(tsQuery: string, limit: number): Promise<SearchResult[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('signals')
    .select('id, title, description, category, signal_score, created_at')
    .eq('status', 'ACTIVE')
    .textSearch('title', tsQuery, { type: 'websearch', config: 'english' })
    .order('signal_score', { ascending: false })
    .limit(limit)

  if (error || !data) {
    // Fallback: ilike search if FTS fails
    const { data: fallback } = await supabase
      .from('signals')
      .select('id, title, description, category, signal_score, created_at')
      .eq('status', 'ACTIVE')
      .ilike('title', `%${tsQuery.replace(/ & /g, '%')}%`)
      .order('signal_score', { ascending: false })
      .limit(limit)

    return (fallback ?? []).map((s: Record<string, unknown>) => ({
      id:       s['id'] as string,
      type:     'signal' as const,
      title:    s['title'] as string,
      summary:  (s['description'] as string).slice(0, 150),
      category: s['category'] as SignalCategory,
      score:    s['signal_score'] as number,
      severity: getSignalSeverity(s['signal_score'] as number),
      href:     `/signals/${s['id'] as string}`,
      date:     s['created_at'] as string,
    }))
  }

  return data.map((s: Record<string, unknown>) => ({
    id:       s['id'] as string,
    type:     'signal' as const,
    title:    s['title'] as string,
    summary:  (s['description'] as string).slice(0, 150),
    category: s['category'] as SignalCategory,
    score:    s['signal_score'] as number,
    severity: getSignalSeverity(s['signal_score'] as number),
    href:     `/signals/${s['id'] as string}`,
    date:     s['created_at'] as string,
  }))
}

// ── Search Events ──────────────────────────────────────────────────────────────

async function searchEvents(tsQuery: string, limit: number): Promise<SearchResult[]> {
  const supabase = await createClient()

  const { data } = await supabase
    .from('events')
    .select('id, title, summary, impact_score, created_at, event_type')
    .textSearch('title', tsQuery, { type: 'websearch', config: 'english' })
    .order('impact_score', { ascending: false })
    .limit(limit)

  if (!data || data.length === 0) {
    const { data: fallback } = await supabase
      .from('events')
      .select('id, title, summary, impact_score, created_at, event_type')
      .ilike('title', `%${tsQuery.replace(/ & /g, '%')}%`)
      .order('impact_score', { ascending: false })
      .limit(limit)

    return (fallback ?? []).map((e: Record<string, unknown>) => ({
      id:      e['id'] as string,
      type:    'event' as const,
      title:   e['title'] as string,
      summary: (e['summary'] as string).slice(0, 150),
      href:    `/events/${e['id'] as string}`,
      date:    e['created_at'] as string,
    }))
  }

  return data.map((e: Record<string, unknown>) => ({
    id:      e['id'] as string,
    type:    'event' as const,
    title:   e['title'] as string,
    summary: (e['summary'] as string).slice(0, 150),
    href:    `/events/${e['id'] as string}`,
    date:    e['created_at'] as string,
  }))
}

// ── Search Reports ─────────────────────────────────────────────────────────────

async function searchReports(tsQuery: string, limit: number): Promise<SearchResult[]> {
  const supabase = await createClient()

  const { data } = await supabase
    .from('reports')
    .select('id, title, summary, report_type, published_at')
    .not('published_at', 'is', null)
    .textSearch('title', tsQuery, { type: 'websearch', config: 'english' })
    .order('published_at', { ascending: false })
    .limit(limit)

  if (!data || data.length === 0) {
    const { data: fallback } = await supabase
      .from('reports')
      .select('id, title, summary, report_type, published_at')
      .not('published_at', 'is', null)
      .ilike('title', `%${tsQuery.replace(/ & /g, '%')}%`)
      .order('published_at', { ascending: false })
      .limit(limit)

    return (fallback ?? []).map((r: Record<string, unknown>) => ({
      id:      r['id'] as string,
      type:    'report' as const,
      title:   r['title'] as string,
      summary: (r['summary'] as string).slice(0, 150),
      href:    `/reports/${r['id'] as string}`,
      date:    r['published_at'] as string,
    }))
  }

  return data.map((r: Record<string, unknown>) => ({
    id:      r['id'] as string,
    type:    'report' as const,
    title:   r['title'] as string,
    summary: (r['summary'] as string).slice(0, 150),
    href:    `/reports/${r['id'] as string}`,
    date:    r['published_at'] as string,
  }))
}

// ── Unified Search ─────────────────────────────────────────────────────────────

export async function search(rawQuery: string): Promise<SearchResults> {
  const query = sanitiseQuery(rawQuery)

  if (query.length < 2) {
    return { signals: [], events: [], reports: [], total: 0, query }
  }

  const [signals, events, reports] = await Promise.all([
    searchSignals(query, 10),
    searchEvents(query, 5),
    searchReports(query, 5),
  ])

  return {
    signals,
    events,
    reports,
    total: signals.length + events.length + reports.length,
    query,
  }
}
