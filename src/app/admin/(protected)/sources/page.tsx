/**
 * AIscentra — Admin Source Registry
 *
 * Recovered verbatim from an early project archive (Readiness
 * Assessment Blocker B-02) -- the sources table's shape used here
 * (name, url, type, trust_score, status, last_checked_at) is unchanged
 * since the archive, confirmed against the live schema before reuse.
 *
 * Frontend Design Foundation, layer 6: the real query is completely
 * unchanged -- only the visual JSX is migrated to vfinal.
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
        <span className="font-caption mb-1 block text-mint-signal">SOURCE REGISTRY</span>
        <h1 className="font-heading text-2xl text-frost">Sources</h1>
        <p className="mt-1 text-sm text-silver-haze">{(sources ?? []).length} registered sources</p>
      </div>

      <div className="divide-y divide-border-subtle border border-border-subtle bg-surface-tonal">
        <div className="grid grid-cols-[1fr_80px_80px_100px_120px] gap-4 bg-deep-obsidian px-4 py-2">
          {['NAME', 'TYPE', 'TRUST', 'STATUS', 'LAST CHECK'].map((h) => (
            <span key={h} className="font-caption text-silver-haze">
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
              className="grid grid-cols-[1fr_80px_80px_100px_120px] items-center gap-4 px-4 py-3 hover:bg-deep-obsidian"
            >
              <div className="min-w-0">
                <p className="truncate text-sm text-silver-haze">{source['name'] as string}</p>
                <p className="truncate font-mono text-xs text-silver-haze opacity-60">
                  {source['url'] as string}
                </p>
              </div>
              <span className="font-mono text-xs text-silver-haze">{source['type'] as string}</span>
              <span
                className={`font-mono text-xs tabular-nums ${
                  trust >= 0.9
                    ? 'text-frost'
                    : trust >= 0.7
                      ? 'text-silver-haze'
                      : 'text-silver-haze opacity-60'
                }`}
              >
                {trust.toFixed(2)}
              </span>
              <span
                className={`font-mono text-xs ${
                  status === 'ACTIVE'
                    ? 'text-mint-signal'
                    : status === 'ERROR'
                      ? 'text-amber-400'
                      : 'text-silver-haze'
                }`}
              >
                {status}
              </span>
              <span className="font-mono text-xs text-silver-haze">
                {lastCheck ? formatRelativeTime(lastCheck) : 'Never'}
              </span>
            </div>
          )
        })}
      </div>

      <div className="mt-6 border border-border-subtle bg-surface-tonal p-4">
        <span className="font-caption mb-2 block text-silver-haze">ADD SOURCE</span>
        <p className="text-xs text-silver-haze">
          Insert new sources directly in Supabase Dashboard → Table Editor → sources. Required
          fields: name, type, url, trust_score (0.0–1.0), status (ACTIVE).
        </p>
        <code className="mt-2 block font-mono text-xs text-silver-haze">
          insert into sources (name, type, url, trust_score) values (...)
        </code>
      </div>
    </div>
  )
}
