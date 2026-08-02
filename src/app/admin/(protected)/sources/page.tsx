/**
 * AIscentra — Admin Source Registry
 *
 * Recovered verbatim from an early project archive (Readiness
 * Assessment Blocker B-02) -- the sources table's shape used here
 * (name, url, type, trust_score, status, last_checked_at) is unchanged
 * since the archive, confirmed against the live schema before reuse.
 */
import { createAdminClient } from '@/lib/supabase/server'
import { formatRelativeTime } from '@/lib/utils/format'

export const dynamic = 'force-dynamic'

export default async function AdminSourcesPage(): Promise<React.JSX.Element> {
  const supabase = createAdminClient()
  const { data: sources } = await supabase
    .from('sources')
    .select('*')
    .order('trust_score', { ascending: false })

  return (
    <div>
      <div className="mb-6">
        <p className="mb-1 font-mono text-xs tracking-wider text-text-muted">SOURCE REGISTRY</p>
        <h1 className="text-2xl font-light text-text-primary">Sources</h1>
        <p className="mt-1 text-sm text-text-muted">{(sources ?? []).length} registered sources</p>
      </div>

      <div className="divide-y divide-observatory-border border border-observatory-border">
        {/* Header */}
        <div className="grid grid-cols-[1fr_80px_80px_100px_120px] gap-4 bg-observatory-surface px-4 py-2">
          {['NAME', 'TYPE', 'TRUST', 'STATUS', 'LAST CHECK'].map((h) => (
            <span key={h} className="font-mono text-xs text-text-muted">
              {h}
            </span>
          ))}
        </div>

        {(sources ?? []).map((source: Record<string, unknown>) => {
          const status = source['status'] as string
          const lastCheck = source['last_checked_at'] as string | null
          const trust = source['trust_score'] as number

          return (
            <div
              key={source['id'] as string}
              className="grid grid-cols-[1fr_80px_80px_100px_120px] items-center gap-4 px-4 py-3 hover:bg-observatory-surface"
            >
              <div className="min-w-0">
                <p className="truncate text-sm text-text-secondary">{source['name'] as string}</p>
                <p className="truncate font-mono text-xs text-text-muted">
                  {source['url'] as string}
                </p>
              </div>
              <span className="font-mono text-xs text-text-muted">{source['type'] as string}</span>
              <span
                className={`font-mono text-xs tabular-nums ${
                  trust >= 0.9
                    ? 'text-text-primary'
                    : trust >= 0.7
                      ? 'text-text-secondary'
                      : 'text-text-muted'
                }`}
              >
                {trust.toFixed(2)}
              </span>
              <span
                className={`font-mono text-xs ${
                  status === 'ACTIVE'
                    ? 'text-text-secondary'
                    : status === 'ERROR'
                      ? 'text-amber-400'
                      : 'text-text-muted'
                }`}
              >
                {status}
              </span>
              <span className="font-mono text-xs text-text-muted">
                {lastCheck ? formatRelativeTime(lastCheck) : 'Never'}
              </span>
            </div>
          )
        })}
      </div>

      <div className="mt-6 border border-observatory-border bg-observatory-surface p-4">
        <p className="mb-2 font-mono text-xs tracking-wider text-text-muted">ADD SOURCE</p>
        <p className="text-xs text-text-muted">
          Insert new sources directly in Supabase Dashboard → Table Editor → sources. Required
          fields: name, type, url, trust_score (0.0–1.0), status (ACTIVE).
        </p>
        <code className="mt-2 block font-mono text-xs text-text-muted">
          insert into sources (name, type, url, trust_score) values (...)
        </code>
      </div>
    </div>
  )
}
