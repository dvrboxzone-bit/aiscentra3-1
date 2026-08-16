import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { VfinalPublicShell } from '@/components/layout/vfinal-public-shell'
import { getReportById } from '@/modules/reports/queries'
import { formatRelativeTime } from '@/lib/utils/format'
import type { ReportType } from '@/types/database'

export const revalidate = 3600

interface ReportPageProps {
  params: Promise<{ slug: string }>
}

const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  SIGNAL_BRIEF: 'Signal Brief',
  EVENT_ANALYSIS: 'Event Analysis',
  WEEKLY_REVIEW: 'Weekly Review',
  TREND_REPORT: 'Trend Report',
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

/**
 * AIscentra — vfinal /reports/[slug] page (Frontend Design Foundation,
 * layer 5B). Real getReportById, paragraph splitting/epistemic-marker
 * detection logic, generateMetadata, generateStaticParams, notFound()
 * -- all unchanged. Visual language migrated to vfinal.
 */
export default async function ReportPage({ params }: ReportPageProps): Promise<React.JSX.Element> {
  const { slug } = await params
  const report = await getReportById(slug)
  if (!report) notFound()

  const paragraphs = report.content
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean)

  return (
    <VfinalPublicShell>
      <div className="textured-bg relative px-6 pb-24 pt-40">
        <div className="tech-grid" />
        <div className="relative z-10 mx-auto max-w-3xl">
          <nav className="font-caption mb-6 text-silver-haze">
            <Link href="/reports" className="hover:text-mint-signal">
              Reports
            </Link>
            <span className="mx-2">›</span>
            <span>{REPORT_TYPE_LABELS[report.report_type]}</span>
          </nav>

          <header className="mb-8 border-b border-border-subtle pb-8">
            <div className="mb-4">
              <span className="pill border border-border-subtle px-2 py-0.5 text-xs text-silver-haze">
                {REPORT_TYPE_LABELS[report.report_type]}
              </span>
            </div>

            <h1 className="font-heading mb-4 text-3xl text-frost md:text-4xl">{report.title}</h1>

            <div className="mb-4 border-l-2 border-mint-signal pl-4">
              <p className="text-lg leading-relaxed text-silver-haze">{report.summary}</p>
            </div>

            <div className="font-caption flex flex-wrap items-center gap-4 text-silver-haze">
              {report.published_at && (
                <time dateTime={report.published_at}>
                  Published {formatRelativeTime(report.published_at)}
                </time>
              )}
              <span>·</span>
              <span>
                {report.signal_ids.length} signal{report.signal_ids.length !== 1 ? 's' : ''}
              </span>
              {report.event_ids.length > 0 && (
                <>
                  <span>·</span>
                  <span>
                    {report.event_ids.length} event{report.event_ids.length !== 1 ? 's' : ''}
                  </span>
                </>
              )}
              <span>·</span>
              <span>REPORT {report.id.slice(0, 8).toUpperCase()}</span>
            </div>
          </header>

          <article className="space-y-5">
            {paragraphs.map((paragraph, index) => {
              const isForecast =
                paragraph.includes('[FORECAST]') ||
                paragraph.startsWith('Expected:') ||
                paragraph.startsWith('Watch for:')

              return (
                <p
                  key={index}
                  className={`leading-relaxed ${
                    isForecast
                      ? 'border-l border-border-subtle pl-4 italic text-silver-haze'
                      : 'text-silver-haze'
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

          <footer className="mt-10 border-t border-border-subtle pt-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <p className="font-caption text-silver-haze">
                AIscentra Intelligence Observatory — {REPORT_TYPE_LABELS[report.report_type]}
              </p>
              <Link
                href="/reports"
                className="font-caption text-silver-haze transition-colors hover:text-mint-signal"
              >
                ← ALL REPORTS
              </Link>
            </div>

            <div className="mt-4 border border-border-subtle bg-surface-tonal p-4">
              <span className="font-caption mb-1 block text-silver-haze">EPISTEMIC NOTE</span>
              <p className="text-xs leading-relaxed text-silver-haze">
                This report distinguishes factual observations from interpretive assessments and
                forecasts. Forecasts are Observatory analytical assessments, not factual claims. All
                intelligence is generated from verified Observatory signals and events.
              </p>
            </div>
          </footer>
        </div>
      </div>
    </VfinalPublicShell>
  )
}
