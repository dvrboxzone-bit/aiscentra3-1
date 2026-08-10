/**
 * AIscentra — Cron: URL Reachability Verification
 *
 * GET /api/cron/verify-urls
 *
 * Real requirement this closes: "без безопасной и подтверждённо
 * доступной ссылки на оригинальный материал сигнал публично не
 * показывается. Хранить результат и время проверки URL; не выполнять
 * внешний запрос при каждом render."
 *
 * Deliberately a SEPARATE endpoint from collection, not verification
 * inside collector.ts: collector.ts's own feed fetch already uses up
 * to 8s of Vercel's 10s function ceiling (see the
 * AbortSignal.timeout(8000) in collector.ts), so adding real per-item
 * network verification there risked timing out collection itself.
 * This endpoint gets its OWN full maxDuration, dedicated only to
 * verification, decoupled from collection's already-tight budget.
 *
 * Processes observations with url_verified_ok IS NULL (never checked)
 * in parallel batches, storing the real result + timestamp on each
 * row. After updating an observation, also recomputes
 * has_verified_source on any signal that observation is linked to
 * (via compute_has_verified_source), so a signal that had no verified
 * source at creation time can still become eligible for publication
 * once its own source is confirmed reachable -- without re-running
 * any AI stage.
 */
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { verifyUrlReachable } from '@/lib/utils/source-links'
import { acquireEnrichmentLock, releaseEnrichmentLock } from '@/lib/ai/execution-lock'

export const maxDuration = 30
export const dynamic = 'force-dynamic'

/** Bounded batch size: real verification is a real network call per
 * item; even in parallel, a very large batch risks exceeding
 * maxDuration when several origins are slow. Remaining unverified rows
 * are picked up by the next scheduled run -- eventual, not immediate,
 * consistency is an acceptable tradeoff here (nothing in the render
 * path depends on THIS specific run completing). */
const BATCH_SIZE = 30

const VERIFY_URLS_LOCK = 'verify_urls_cycle'

export async function GET(request: Request): Promise<NextResponse> {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env['CRON_SECRET']}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const lockHolder = `verify-urls:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lockClient = supabase as any

  const gotLock = await acquireEnrichmentLock(lockClient, lockHolder, 300, VERIFY_URLS_LOCK)
  if (!gotLock) {
    return NextResponse.json({ skipped: true, reason: 'verify_urls_already_running' })
  }

  try {
    const { data: pending, error } = await supabase
      .from('observations')
      .select('id, url, signal_id')
      .is('url_verified_ok', null)
      .limit(BATCH_SIZE)

    if (error) {
      console.error('[cron/verify-urls] fetch failed:', error.message)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const rows = (pending ?? []) as Array<{ id: string; url: string; signal_id: string | null }>
    if (rows.length === 0) {
      return NextResponse.json({ verified: 0, message: 'No pending URLs' })
    }

    const results = await Promise.all(
      rows.map(async (row) => ({
        id: row.id,
        signalId: row.signal_id,
        ok: await verifyUrlReachable(row.url),
      })),
    )

    const verifiedAt = new Date().toISOString()
    let okCount = 0
    let failCount = 0
    const affectedSignalIds = new Set<string>()
    let writeFailures = 0

    for (const r of results) {
      // REAL BUG FIXED (architectural review): this write's `error`
      // was previously never even extracted, let alone checked -- a
      // silent DB write failure (transient network issue, RLS,
      // malformed data) proceeded as if the verification result had
      // been persisted, and the final response summary would falsely
      // report success. Now checked explicitly and counted separately
      // from the verification result itself (a WRITE failure is not
      // the same thing as a URL being unreachable).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: writeError } = await (supabase as any)
        .from('observations')
        .update({ url_verified_ok: r.ok, url_verified_at: verifiedAt })
        .eq('id', r.id)

      if (writeError) {
        writeFailures++
        console.error(
          `[cron/verify-urls] failed to persist verification result for observation ${r.id}: ${writeError.message}`,
        )
        // Do not count this row's verification result or affect any
        // signal's gate -- the write did not actually happen, so
        // nothing about this observation's state has genuinely
        // changed.
        continue
      }

      if (r.ok) okCount++
      else failCount++
      if (r.signalId) affectedSignalIds.add(r.signalId)
    }

    // Recompute the publication gate for every affected signal. Each
    // signal's own observation_ids array is the source of truth for
    // compute_has_verified_source, so this is correct regardless of
    // how many observations link to it.
    let gateWriteFailures = 0
    for (const signalId of affectedSignalIds) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: sig, error: sigReadError } = await (supabase as any)
        .from('signals')
        .select('observation_ids')
        .eq('id', signalId)
        .single()
      if (sigReadError) {
        gateWriteFailures++
        console.error(
          `[cron/verify-urls] failed to read signal ${signalId} for gate recompute: ${sigReadError.message}`,
        )
        continue
      }
      if (!sig) continue

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: gateResult, error: rpcError } = await (supabase as any).rpc(
        'compute_has_verified_source',
        {
          p_observation_ids: sig.observation_ids,
        },
      )
      if (rpcError) {
        gateWriteFailures++
        console.error(
          `[cron/verify-urls] compute_has_verified_source RPC failed for signal ${signalId}: ${rpcError.message}`,
        )
        continue
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: gateWriteError } = await (supabase as any)
        .from('signals')
        .update({ has_verified_source: gateResult === true })
        .eq('id', signalId)
      if (gateWriteError) {
        gateWriteFailures++
        console.error(
          `[cron/verify-urls] failed to write has_verified_source for signal ${signalId}: ${gateWriteError.message}`,
        )
      }
    }

    return NextResponse.json({
      verified: results.length,
      ok: okCount,
      failed: failCount,
      writeFailures,
      gateWriteFailures,
      signalsReevaluated: affectedSignalIds.size,
      timestamp: verifiedAt,
    })
  } finally {
    await releaseEnrichmentLock(lockClient, lockHolder, VERIFY_URLS_LOCK)
  }
}
