import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getReportById } from '@/modules/reports/queries'
import { formatRelativeTime } from '@/lib/utils/format'
import type { ReportType } from '@/types/database'

export const revalidate = 3600

interface ReportPageProps {
  params: Promise<{ slug: string }>
}

const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  SIGNAL_BRIEF:   'Signal Brief',
  EVENT_ANALYSIS: 'Event Analysis',
  WEEKLY_REVIEW:  'Weekly Review',
  TREND_REPORT:   'Trend Report',
}

export async function generateStaticParams(): Promise<{ slug: string }[]> {
  return []
}

export async function generateMetadata({ params }: ReportPageProps): Promise<Metadata> {
  const { slug } = await params
  const report = await getReportById(slug)
  if (!report) return { title: 'Report Not Found' }
  return { title: report.title, description: report.summary }
}

export default async function ReportPage({ params }: ReportPageProps): Promise<React.JSX.Element> {
  const { slug } = await params
  const report = await getReportById(slug)
  if (!report) notFound()

  // Format content — split into paragraphs for reading layout
  const paragraphs = report.content
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean)

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">

      {/* Breadcrumb */}
      <nav className="mb-6 font-mono text-xs text-text-muted">
        <a href="/reports" className="hover:text-text-secondary">Reports</a>
        <span className="mx-2 text-observatory-border">›</span>
        <span>{REPORT_TYPE_LABELS[report.report_type]}</span>
      </nav>

      {/* Header */}
      <header className="mb-8 border-b border-observatory-border pb-8">
        <div className="mb-4">
          <span className="border border-observatory-border px-2 py-0.5 font-mono text-xs text-text-muted">
            {REPORT_TYPE_LABELS[report.report_type]}
          </span>
        </div>

        <h1 className="mb-4 text-xl font-medium leading-snug text-text-primary md:text-2xl">
          {report.title}
        </h1>

        {/* Summary block */}
        <div className="border-l-2 border-observatory-border pl-4 mb-4">
          <p className="text-sm leading-relaxed text-text-secondary">{report.summary}</p>
        </div>

        <div className="flex flex-wrap items-center gap-4 font-mono text-xs text-text-muted">
          {report.published_at && (
            <time dateTime={report.published_at}>
              Published {formatRelativeTime(report.published_at)}
            </time>
          )}
          <span className="text-observatory-border">·</span>
          <span>{report.signal_ids.length} signal{report.signal_ids.length !== 1 ? 's' : ''}</span>
          {report.event_ids.length > 0 && (
            <>
              <span className="text-observatory-border">·</span>
              <span>{report.event_ids.length} event{report.event_ids.length !== 1 ? 's' : ''}</span>
            </>
          )}
          <span className="text-observatory-border">·</span>
          <span>REPORT {report.id.slice(0, 8).toUpperCase()}</span>
        </div>
      </header>

      {/* Report content */}
      <article className="space-y-5">
        {paragraphs.map((paragraph, index) => {
          // Detect epistemic markers and style accordingly
          const isForecast    = paragraph.includes('[FORECAST]') || paragraph.startsWith('Expected:') || paragraph.startsWith('Watch for:')
          const isInterpretive = paragraph.includes('[INTERPRETIVE]')

          return (
            <p
              key={index}
              className={`text-sm leading-relaxed ${
                isForecast
                  ? 'text-text-muted italic border-l border-observatory-border pl-4'
                  : isInterpretive
                  ? 'text-text-secondary'
                  : 'text-text-secondary'
              }`}
            >
              {paragraph
                .replace('[FACTUAL]', '')
                .replace('[INTERPRETIVE]', '')
                .replace('[HYPOTHETICAL]', '')
                .replace('[FORECAST]', '')
                .trim()}
            </p>
          )
        })}
      </article>

      {/* Footer */}
      <footer className="mt-10 border-t border-observatory-border pt-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="font-mono text-xs text-text-muted">
            AIscentra Intelligence Observatory — {REPORT_TYPE_LABELS[report.report_type]}
          </p>
          <a
            href="/reports"
            className="font-mono text-xs tracking-wider text-text-muted transition-colors hover:text-text-secondary"
          >
            ← ALL REPORTS
          </a>
        </div>

        {/* Epistemic disclaimer */}
        <div className="mt-4 border border-observatory-border bg-observatory-surface p-4">
          <p className="font-mono text-xs text-text-muted mb-1">EPISTEMIC NOTE</p>
          <p className="text-xs text-text-muted leading-relaxed">
            This report distinguishes factual observations from interpretive assessments and forecasts.
            Forecasts are Observatory analytical assessments, not factual claims.
            All intelligence is generated from verified Observatory signals and events.
          </p>
        </div>
      </footer>
    </div>
  )
}
