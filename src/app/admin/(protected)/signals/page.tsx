/**
 * AIscentra — Admin Signals List
 *
 * Recovered from an early project archive (Readiness Assessment Blocker
 * B-02). Adapted here: the status tab list now covers the full current
 * SignalStatus union (CANDIDATE, DRAFT, WEAK, ACTIVE, PROMOTED, EXPIRED,
 * DORMANT, REJECTED) -- the archive only listed 5 of these 8 values,
 * predating the V2 lifecycle states WEAK/CANDIDATE/DORMANT.
 *
 * Frontend Design Foundation, layer 6: real query (status filter,
 * pagination via range(), status-count tabs), real /signals/[id]
 * links -- all UNCHANGED, only the visual JSX is migrated to vfinal.
 */
import Link from 'next/link'
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
          <span className="font-caption mb-1 block text-mint-signal">SIGNAL MANAGEMENT</span>
          <h1 className="font-heading text-2xl text-frost">Signals</h1>
        </div>
        <span className="font-caption text-silver-haze">
          {count ?? 0} {status.toLowerCase()}
        </span>
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        {statusCounts.map(({ status: s, count: c }) => (
          <Link
            key={s}
            href={`/admin/signals?status=${s}`}
            className={`px-3 py-1 text-xs font-medium transition-colors ${
              s === status
                ? 'border border-border-subtle bg-surface-tonal text-frost'
                : 'text-silver-haze hover:text-mint-signal'
            }`}
          >
            {s} ({c})
          </Link>
        ))}
      </div>

      <div className="divide-y divide-border-subtle border border-border-subtle bg-surface-tonal">
        <div className="grid grid-cols-[80px_60px_60px_1fr_100px_100px] gap-4 bg-deep-obsidian px-4 py-2">
          {['SCORE', 'CONF', 'CAT', 'TITLE', 'CREATED', 'ACTIONS'].map((h) => (
            <span key={h} className="font-caption text-silver-haze">
              {h}
            </span>
          ))}
        </div>

        {(signals ?? []).length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-silver-haze">
            No {status.toLowerCase()} signals.
          </div>
        ) : (
          (signals ?? []).map((signal: Record<string, unknown>) => {
            const score = signal['signal_score'] as number
            const conf = signal['confidence_score'] as number
            const severity = getSignalSeverity(score)
            const sevColor =
              severity === 'CRITICAL'
                ? 'text-frost'
                : severity === 'HIGH'
                  ? 'text-mint-signal'
                  : severity === 'MEDIUM'
                    ? 'text-silver-haze'
                    : 'text-silver-haze opacity-60'
            const validationFlags = (signal['validation_flags'] as string[] | null) ?? []

            return (
              <div
                key={signal['id'] as string}
                className="grid grid-cols-[80px_60px_60px_1fr_100px_100px] items-center gap-4 px-4 py-3 hover:bg-deep-obsidian"
              >
                <span className={`font-mono text-xs tabular-nums ${sevColor}`}>{score}</span>
                <span className="font-mono text-xs tabular-nums text-silver-haze">{conf}%</span>
                <span className="truncate font-mono text-xs text-silver-haze">
                  {(signal['category'] as string).slice(0, 6)}
                </span>
                <div className="min-w-0">
                  <a
                    href={`/signals/${signal['id'] as string}`}
                    target="_blank"
                    rel="noreferrer"
                    className="block truncate text-xs text-silver-haze hover:text-mint-signal"
                  >
                    {signal['title'] as string}
                  </a>
                  {validationFlags.length > 0 && (
                    <span className="text-xs text-amber-400">⚠ {validationFlags.length} flag</span>
                  )}
                </div>
                <span className="font-caption text-silver-haze">
                  {formatRelativeTime(signal['created_at'] as string)}
                </span>
                <div className="flex gap-2">
                  <a
                    href={`/signals/${signal['id'] as string}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-caption text-silver-haze hover:text-mint-signal"
                  >
                    VIEW
                  </a>
                </div>
              </div>
            )
          })
        )}
      </div>

      {totalPages > 1 && (
        <div className="font-caption mt-4 flex items-center justify-between text-silver-haze">
          <span>
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-3">
            {page > 1 && (
              <Link
                href={`/admin/signals?status=${status}&page=${page - 1}`}
                className="hover:text-mint-signal"
              >
                ← Prev
              </Link>
            )}
            {page < totalPages && (
              <Link
                href={`/admin/signals?status=${status}&page=${page + 1}`}
                className="hover:text-mint-signal"
              >
                Next →
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
