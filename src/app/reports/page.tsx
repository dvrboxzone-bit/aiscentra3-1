import type { Metadata } from 'next'
import { getReports } from '@/modules/reports/queries'
import { formatRelativeTime } from '@/lib/utils/format'
import type { ReportType } from '@/types/database'

export const metadata: Metadata = {
  title: 'Reports',
  description: 'Intelligence publications — signal briefs, event analyses, weekly reviews and trend reports.',
}

export const revalidate = 3600

const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  SIGNAL_BRIEF:   'Signal Brief',
  EVENT_ANALYSIS: 'Event Analysis',
  WEEKLY_REVIEW:  'Weekly Review',
  TREND_REPORT:   'Trend Report',
}

const REPORT_TYPE_DESCRIPTIONS: Record<ReportType, string> = {
  SIGNAL_BRIEF:   'Concise analysis of a single high-significance signal.',
  EVENT_ANALYSIS: 'Deep interpretation of a promoted ecosystem event.',
  WEEKLY_REVIEW:  'Synthesis of the week\'s significant developments.',
  TREND_REPORT:   'Pattern analysis across a signal category over 30 days.',
}

export default async function ReportsPage(): Promise<React.JSX.Element> {
  const reports = await getReports(undefined, 30)

  return (
    <div className="mx-auto max-w-7xl">
      {/* Header */}
      <div className="border-b border-observatory-border px-6 py-8">
        <p className="mb-1 font-mono text-xs tracking-wider text-text-muted">INTELLIGENCE PUBLICATIONS</p>
        <h1 className="text-2xl font-light text-text-primary">Reports</h1>
        <p className="mt-2 text-sm text-text-muted">
          {reports.length > 0
            ? `${reports.length} intelligence report${reports.length !== 1 ? 's' : ''} published`
            : 'Reports are generated daily from Observatory signals and events'}
        </p>
      </div>

      {/* Report type legend */}
      <div className="grid border-b border-observatory-border md:grid-cols-4">
        {(Object.entries(REPORT_TYPE_LABELS) as [ReportType, string][]).map(([type, label]) => (
          <div key={type} className="border-r border-observatory-border p-5 last:border-r-0">
            <p className="mb-1 font-mono text-xs tracking-wider text-text-muted">{type}</p>
            <p className="mb-1.5 text-sm font-medium text-text-primary">{label}</p>
            <p className="text-xs text-text-muted">{REPORT_TYPE_DESCRIPTIONS[type]}</p>
          </div>
        ))}
      </div>

      {/* Report list */}
      {reports.length === 0 ? (
        <div className="px-6 py-20 text-center">
          <p className="mb-2 font-mono text-xs tracking-wider text-text-muted">CONTENT INTELLIGENCE LAYER</p>
          <h2 className="mb-3 text-lg font-light text-text-primary">First Reports Pending</h2>
          <p className="mx-auto max-w-md text-sm text-text-muted">
            Reports are generated daily at 06:00 UTC from Observatory events and signals.
            The first Weekly Review publishes every Monday.
          </p>
        </div>
      ) : (
        <div>
          {reports.map((report) => (
            <a
              key={report.id}
              href={`/reports/${report.id}`}
              className="group block border-b border-observatory-border px-6 py-5 transition-colors hover:bg-observatory-surface"
            >
              <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                <span className="border border-observatory-border px-2 py-0.5 font-mono text-xs text-text-muted">
                  {REPORT_TYPE_LABELS[report.report_type]}
                </span>
                <time className="font-mono text-xs text-text-muted" dateTime={report.published_at ?? ''}>
                  {report.published_at ? formatRelativeTime(report.published_at) : 'Draft'}
                </time>
              </div>
              <h3 className="mb-1.5 text-sm font-medium text-text-secondary transition-colors group-hover:text-text-primary">
                {report.title}
              </h3>
              <p className="text-xs leading-relaxed text-text-muted line-clamp-2">{report.summary}</p>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
