import type { Metadata } from 'next'
import Link from 'next/link'
import { VfinalPublicShell } from '@/components/layout/vfinal-public-shell'
import { getReports } from '@/modules/reports/queries'
import { formatRelativeTime } from '@/lib/utils/format'
import type { ReportType } from '@/types/database'

export const metadata: Metadata = {
  title: 'Reports — AIscentra',
  description:
    'Intelligence publications — signal briefs, event analyses, weekly reviews and trend reports.',
}

export const revalidate = 3600

const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  SIGNAL_BRIEF: 'Signal Brief',
  EVENT_ANALYSIS: 'Event Analysis',
  WEEKLY_REVIEW: 'Weekly Review',
  TREND_REPORT: 'Trend Report',
}

const REPORT_TYPE_DESCRIPTIONS: Record<ReportType, string> = {
  SIGNAL_BRIEF: 'Concise analysis of a single high-significance signal.',
  EVENT_ANALYSIS: 'Deep interpretation of a promoted ecosystem event.',
  WEEKLY_REVIEW: "Synthesis of the week's significant developments.",
  TREND_REPORT: 'Pattern analysis across a signal category over 30 days.',
}

/**
 * AIscentra — vfinal /reports page (Frontend Design Foundation, layer
 * 5B). Real getReports() query, report-type legend/descriptions,
 * empty-state copy -- all unchanged. Visual language migrated to
 * vfinal.
 */
export default async function ReportsPage(): Promise<React.JSX.Element> {
  const reports = await getReports(undefined, 30)

  return (
    <VfinalPublicShell>
      <div className="textured-bg relative px-6 pb-24 pt-40">
        <div className="tech-grid" />
        <div className="relative z-10 mx-auto max-w-[1200px]">
          <span className="font-caption mb-4 block text-mint-signal">
            INTELLIGENCE PUBLICATIONS
          </span>
          <h1 className="font-display mb-6 text-[12vw] text-frost md:text-[80px]">Reports.</h1>
          <p className="mb-12 text-lg text-silver-haze">
            {reports.length > 0
              ? `${reports.length} intelligence report${reports.length !== 1 ? 's' : ''} published`
              : 'Reports are generated daily from Observatory signals and events'}
          </p>

          <div className="mb-12 grid border border-border-subtle bg-deep-obsidian md:grid-cols-4">
            {(Object.entries(REPORT_TYPE_LABELS) as [ReportType, string][]).map(([type, label]) => (
              <div key={type} className="bg-surface-tonal p-5">
                <p className="font-caption mb-1 text-silver-haze">{type}</p>
                <p className="mb-1.5 text-sm font-medium text-frost">{label}</p>
                <p className="text-xs text-silver-haze">{REPORT_TYPE_DESCRIPTIONS[type]}</p>
              </div>
            ))}
          </div>

          {reports.length === 0 ? (
            <div className="border border-border-subtle bg-surface-tonal px-6 py-20 text-center">
              <span className="font-caption mb-2 block text-silver-haze">
                CONTENT INTELLIGENCE LAYER
              </span>
              <h2 className="font-heading mb-3 text-2xl text-frost">First Reports Pending</h2>
              <p className="mx-auto max-w-md text-silver-haze">
                Reports are generated daily at 06:00 UTC from Observatory events and signals. The
                first Weekly Review publishes every Monday.
              </p>
            </div>
          ) : (
            <div className="grid gap-px border border-border-subtle bg-deep-obsidian">
              {reports.map((report) => (
                <Link
                  key={report.id}
                  href={`/reports/${report.id}`}
                  className="group block bg-surface-tonal px-6 py-5 transition-colors hover:bg-deep-obsidian"
                >
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                    <span className="pill border border-border-subtle px-2 py-0.5 text-xs text-silver-haze">
                      {REPORT_TYPE_LABELS[report.report_type]}
                    </span>
                    <time
                      className="font-caption text-silver-haze"
                      dateTime={report.published_at ?? ''}
                    >
                      {report.published_at ? formatRelativeTime(report.published_at) : 'Draft'}
                    </time>
                  </div>
                  <h3 className="mb-1.5 text-lg font-medium text-frost transition-colors group-hover:text-mint-signal">
                    {report.title}
                  </h3>
                  <p className="line-clamp-2 text-sm leading-relaxed text-silver-haze">
                    {report.summary}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </VfinalPublicShell>
  )
}
