/**
 * AIscentra — Admin Signals List
 *
 * Recovered from an early project archive (Readiness Assessment Blocker
 * B-02). Adapted here: the status tab list now covers the full current
 * SignalStatus union (CANDIDATE, DRAFT, WEAK, ACTIVE, PROMOTED, EXPIRED,
 * DORMANT, REJECTED) -- the archive only listed 5 of these 8 values,
 * predating the V2 lifecycle states WEAK/CANDIDATE/DORMANT.
 */
import { createAdminClient } from '@/lib/supabase/server'
import { formatRelativeTime } from '@/lib/utils/format'
import { getSignalSeverity, type SignalStatus } from '@/types/database'

export const dynamic = 'force-dynamic'

const ALL_STATUSES: SignalStatus[] = [
  'CANDIDATE',
  'DRAFT',
  'WEAK',
  'ACTIVE',
  'PROMOTED',
  'DORMANT',
  'EXPIRED',
  'REJECTED',
]

interface SearchParams {
  status?: string
  page?: string
}

interface AdminSignalsPageProps {
  searchParams: Promise<SearchParams>
}

export default async function AdminSignalsPage({
  searchParams,
}: AdminSignalsPageProps): Promise<React.JSX.Element> {
  const params = await searchParams
  const status = (params.status ?? 'ACTIVE') as SignalStatus
  const page = parseInt(params.page ?? '1', 10)
  const pageSize = 25
  const offset = (page - 1) * pageSize

  const supabase = createAdminClient()

  const { data: signals, count } = await supabase
    .from('signals')
    .select('*', { count: 'exact' })
    .eq('status', status)
    .order('created_at', { ascending: false })
    .range(offset, offset + pageSize - 1)

  const totalPages = Math.ceil((count ?? 0) / pageSize)

  // Count by status for tabs
  const statusCounts = await Promise.all(
    ALL_STATUSES.map(async (s) => {
      const { count: c } = await supabase
        .from('signals')
        .select('id', { count: 'exact', head: true })
        .eq('status', s)
      return { status: s, count: c ?? 0 }
    }),
  )

  return (
    <div>
      <div className="mb-6 flex items-baseline justify-between">
        <div>
          <p className="mb-1 font-mono text-xs tracking-wider text-text-muted">SIGNAL MANAGEMENT</p>
          <h1 className="text-2xl font-light text-text-primary">Signals</h1>
        </div>
        <span className="font-mono text-xs text-text-muted">
          {count ?? 0} {status.toLowerCase()}
        </span>
      </div>

      {/* Status tabs */}
      <div className="mb-6 flex flex-wrap gap-2">
        {statusCounts.map(({ status: s, count: c }) => (
          <a
            key={s}
            href={`/admin/signals?status=${s}`}
            className={`px-3 py-1 font-mono text-xs transition-colors ${
              s === status
                ? 'border border-observatory-border bg-observatory-surface text-text-primary'
                : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            {s} ({c})
          </a>
        ))}
      </div>

      {/* Signal list */}
      <div className="divide-y divide-observatory-border border border-observatory-border">
        {/* Header */}
        <div className="grid grid-cols-[80px_60px_60px_1fr_100px_100px] gap-4 bg-observatory-surface px-4 py-2">
          {['SCORE', 'CONF', 'CAT', 'TITLE', 'CREATED', 'ACTIONS'].map((h) => (
            <span key={h} className="font-mono text-xs text-text-muted">
              {h}
            </span>
          ))}
        </div>

        {(signals ?? []).length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-text-muted">
            No {status.toLowerCase()} signals.
          </div>
        ) : (
          (signals ?? []).map((signal: Record<string, unknown>) => {
            const score = signal['signal_score'] as number
            const conf = signal['confidence_score'] as number
            const severity = getSignalSeverity(score)
            const sevColor =
              severity === 'CRITICAL'
                ? 'text-text-primary'
                : severity === 'HIGH'
                  ? 'text-signal-high'
                  : severity === 'MEDIUM'
                    ? 'text-signal-medium'
                    : 'text-signal-low'
            const validationFlags = (signal['validation_flags'] as string[] | null) ?? []

            return (
              <div
                key={signal['id'] as string}
                className="grid grid-cols-[80px_60px_60px_1fr_100px_100px] items-center gap-4 px-4 py-3 hover:bg-observatory-surface"
              >
                <span className={`font-mono text-xs tabular-nums ${sevColor}`}>{score}</span>
                <span className="font-mono text-xs tabular-nums text-text-muted">{conf}%</span>
                <span className="truncate font-mono text-xs text-text-muted">
                  {(signal['category'] as string).slice(0, 6)}
                </span>
                <div className="min-w-0">
                  <a
                    href={`/signals/${signal['id'] as string}`}
                    target="_blank"
                    rel="noreferrer"
                    className="block truncate text-xs text-text-secondary hover:text-text-primary"
                  >
                    {signal['title'] as string}
                  </a>
                  {validationFlags.length > 0 && (
                    <span className="text-xs text-amber-400">⚠ {validationFlags.length} flag</span>
                  )}
                </div>
                <span className="font-mono text-xs text-text-muted">
                  {formatRelativeTime(signal['created_at'] as string)}
                </span>
                <div className="flex gap-2">
                  <a
                    href={`/signals/${signal['id'] as string}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-xs text-text-muted hover:text-text-secondary"
                  >
                    VIEW
                  </a>
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between font-mono text-xs text-text-muted">
          <span>
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-3">
            {page > 1 && (
              <a
                href={`/admin/signals?status=${status}&page=${page - 1}`}
                className="hover:text-text-secondary"
              >
                ← Prev
              </a>
            )}
            {page < totalPages && (
              <a
                href={`/admin/signals?status=${status}&page=${page + 1}`}
                className="hover:text-text-secondary"
              >
                Next →
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
