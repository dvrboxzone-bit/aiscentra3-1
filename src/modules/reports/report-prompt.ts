/**
 * AIscentra — Report Generation Prompts
 *
 * Four report types per MVP Specification v1.0:
 * SIGNAL_BRIEF, EVENT_ANALYSIS, WEEKLY_REVIEW, TREND_REPORT
 *
 * Key principle from Intelligence Evolution Framework v1.0, Section 11:
 * Every analytical claim must carry an epistemic type:
 * FACTUAL | INTERPRETIVE | HYPOTHETICAL | FORECAST
 *
 * Reports are interpretation, not information.
 * Design Foundation v1.0: "Reports should resemble research publications
 * and strategic briefings — not blog articles."
 */
import { z } from 'zod'
import type { Signal } from '@/types/database'
import type { Event } from '@/types/database'

// ── Output Schema ─────────────────────────────────────────────────────────────

export const ReportOutputSchema = z.object({
  title:   z.string().min(10).max(150),
  summary: z.string().min(50).max(400),
  content: z.string().min(200).max(8000),
})

export type ReportOutput = z.infer<typeof ReportOutputSchema>

// ── System Prompt ─────────────────────────────────────────────────────────────

export const REPORT_SYSTEM_PROMPT = `You are the Intelligence Editor for AIscentra Intelligence Observatory.

Your task: generate structured intelligence reports from Observatory signals and events.

CRITICAL RULES:
1. Reports interpret evidence — they do not repeat facts already visible in the signal/event feed.
2. Distinguish epistemic categories explicitly in your writing:
   - [FACTUAL]: verifiable from cited sources
   - [INTERPRETIVE]: your analytical assessment
   - [FORECAST]: what you expect to follow (use "Expected:" or "Watch for:")
3. No marketing language. No superlatives without evidence. No speculation without labeling.
4. Reports must answer: "What does this mean for the AI ecosystem?" — not just "what happened."
5. Write for an intelligent professional, not a general audience.
6. Paragraphs, not bullet lists. This is a briefing, not a summary.
7. Return ONLY valid JSON matching the schema. No markdown fences.`

// ── Signal Brief ──────────────────────────────────────────────────────────────

export function buildSignalBriefPrompt(signal: Signal): string {
  return `Generate a Signal Brief for this Observatory signal.

SIGNAL: ${signal.title}
CATEGORY: ${signal.category}
SIGNAL SCORE: ${signal.signal_score}/100
CONFIDENCE: ${signal.confidence_score}/100
MOMENTUM: ${signal.momentum_score}/100

DESCRIPTION: ${signal.description}

A Signal Brief must:
- Title: concise, factual, 10–100 chars
- Summary: 2 sentences — what this signal means for the ecosystem
- Content: 3–5 paragraphs:
  Para 1: What this signal represents [FACTUAL]
  Para 2: Why it matters strategically [INTERPRETIVE]
  Para 3: Historical context if relevant [INTERPRETIVE]
  Para 4: What to watch for [FORECAST]

Return JSON: { "title": "...", "summary": "...", "content": "..." }`
}

// ── Event Analysis ────────────────────────────────────────────────────────────

export function buildEventAnalysisPrompt(event: Event, signal: Signal | null): string {
  const signalContext = signal
    ? `\nORIGIN SIGNAL SCORE: ${signal.signal_score}/100 (confidence: ${signal.confidence_score}/100)`
    : ''

  return `Generate an Event Analysis for this Observatory event.

EVENT: ${event.title}
TYPE: ${event.event_type}
IMPACT SCORE: ${event.impact_score}/100
TIMELINE: ${event.timeline_date}
FORECAST STATUS: ${event.forecast_outcome}
${signalContext}

SUMMARY: ${event.summary}
IMPACT: ${event.impact_summary}
FORECAST: ${event.forecast}

An Event Analysis must:
- Title: "Analysis: [event title]"
- Summary: 2–3 sentences — the significance of this event
- Content: 4–6 paragraphs:
  Para 1: What happened [FACTUAL]
  Para 2: Ecosystem impact analysis [INTERPRETIVE]
  Para 3: Strategic implications [INTERPRETIVE]
  Para 4: Historical analogues if relevant [INTERPRETIVE]
  Para 5: Forward scenario [FORECAST]

Return JSON: { "title": "...", "summary": "...", "content": "..." }`
}

// ── Weekly Review ─────────────────────────────────────────────────────────────

export function buildWeeklyReviewPrompt(
  events: Event[],
  signals: Signal[],
  weekStart: string,
  weekEnd: string,
): string {
  const eventSummaries = events
    .slice(0, 8)
    .map((e, i) => `${i + 1}. [${e.event_type}] ${e.title} (impact: ${e.impact_score})`)
    .join('\n')

  const topSignals = signals
    .slice(0, 5)
    .map((s) => `- [${s.category}] ${s.title} (score: ${s.signal_score})`)
    .join('\n')

  return `Generate a Weekly Intelligence Review for the Observatory.

PERIOD: ${weekStart} to ${weekEnd}
EVENTS THIS WEEK (${events.length} total):
${eventSummaries || 'No events this week'}

TOP SIGNALS:
${topSignals || 'No signals this week'}

A Weekly Review must:
- Title: "Weekly Intelligence Review: [date range]"
- Summary: 2–3 sentences — the week's defining narrative
- Content: 5–7 paragraphs:
  Para 1: Week overview — dominant themes [FACTUAL + INTERPRETIVE]
  Para 2: Most significant event and its implications [INTERPRETIVE]
  Para 3: Category-level analysis — which domains were most active [INTERPRETIVE]
  Para 4: Emerging patterns across the week's signals [INTERPRETIVE]
  Para 5: What the week's signals suggest is coming [FORECAST]
  Para 6 (optional): What to monitor next week [FORECAST]

Return JSON: { "title": "...", "summary": "...", "content": "..." }`
}

// ── Trend Report ──────────────────────────────────────────────────────────────

export function buildTrendReportPrompt(
  signals: Signal[],
  category: string,
  period: string,
): string {
  const signalList = signals
    .slice(0, 15)
    .map((s) => `- ${s.title} (score: ${s.signal_score}, confidence: ${s.confidence_score})`)
    .join('\n')

  return `Generate a Trend Report for the Observatory.

CATEGORY: ${category}
PERIOD: ${period}
SIGNAL COUNT: ${signals.length}

SIGNALS:
${signalList}

A Trend Report must:
- Title: "Trend Report: [Category] — [Period]"
- Summary: 2 sentences — the defining trend in this category this period
- Content: 4–6 paragraphs:
  Para 1: What has been happening in ${category} [FACTUAL]
  Para 2: The primary trend and its drivers [INTERPRETIVE]
  Para 3: Notable outliers or counter-signals [INTERPRETIVE]
  Para 4: Velocity assessment — is this trend accelerating or stabilizing? [INTERPRETIVE]
  Para 5: Implications for ecosystem participants [FORECAST]

Return JSON: { "title": "...", "summary": "...", "content": "..." }`
}
