/**
 * AIscentra — cross-platform execution lock and ledger maintenance
 *
 * WHY A DATABASE LOCK AND NOT GitHub `concurrency:`
 *
 * GitHub Actions' concurrency group serializes runs of that ONE
 * workflow. It is blind to the Vercel cron (vercel.json ->
 * /api/cron/pipeline -> /api/enrich/batch), so it cannot prevent a
 * Vercel-driven enrichment cycle from running at the same time as a
 * GitHub-driven one. Claiming cross-platform protection from it would
 * be false. The lock below lives in the database that every trigger
 * already shares, so it holds regardless of what launched the run:
 * GitHub schedule, GitHub manual dispatch, or Vercel cron.
 *
 * WHY A LEASE ROW AND NOT pg_advisory_lock
 *
 * An advisory lock is bound to a database session. Serverless
 * functions do not hold a stable session for the duration of an
 * invocation, and a Vercel function killed at 60s would leave an
 * advisory lock in an ambiguous state. A row carrying an explicit
 * expiry survives the holder vanishing (crash, kill, runner eviction)
 * and self-heals once the lease lapses -- no manual unsticking.
 *
 * It is deliberately independent of consume_ai_token_budget's advisory
 * lock: separate scopes (a whole enrichment cycle vs. a single budget
 * decision), separate tables, no interaction. Taking this lock never
 * blocks the budget RPC.
 */

export const ENRICHMENT_LOCK = 'enrichment_cycle'

/** Minimal client shape, matching this repo's existing loose-typing convention. */
export interface LockRpcClient {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>
}

/**
 * Attempts to take the enrichment lease.
 *
 * TTL defaults to 5 minutes: comfortably longer than one enrichment
 * invocation (Vercel caps the function at 60s) but short enough that a
 * crashed holder blocks the next scheduled cycle for minutes, not
 * hours. Cycles run every ~4 hours, so a lapsed lease is always
 * reclaimed well before the next one is due.
 *
 * Returns false rather than throwing when the lock is held: a losing
 * run must exit cleanly and WITHOUT calling Groq, which is a normal,
 * expected outcome, not an error.
 *
 * On RPC failure returns FALSE (fail-closed). An enrichment cycle that
 * cannot prove it holds the lock must not run: proceeding blind is
 * exactly the overlap this exists to prevent, and skipping one cycle
 * is far cheaper than two cycles racing the same TPD budget.
 */
export async function acquireEnrichmentLock(
  client: LockRpcClient,
  holder: string,
  ttlSeconds = 300,
): Promise<boolean> {
  try {
    const { data, error } = await client.rpc('acquire_execution_lock', {
      p_lock_name: ENRICHMENT_LOCK,
      p_holder: holder,
      p_ttl: `${ttlSeconds} seconds`,
    })
    if (error) {
      console.error(
        JSON.stringify({
          event: 'enrichment_lock_error',
          severity: 'alert',
          phase: 'acquire',
          holder,
          error: error.message,
          decision: 'fail-closed: cycle skipped rather than risk an overlapping run',
        }),
      )
      return false
    }
    return data === true
  } catch (err) {
    console.error(
      JSON.stringify({
        event: 'enrichment_lock_error',
        severity: 'alert',
        phase: 'acquire',
        holder,
        error: err instanceof Error ? err.message : String(err),
        decision: 'fail-closed: cycle skipped rather than risk an overlapping run',
      }),
    )
    return false
  }
}

/**
 * Releases the lease. Never throws -- a failed release is not worth
 * failing an otherwise-successful run over, because the lease expires
 * on its own regardless.
 */
export async function releaseEnrichmentLock(client: LockRpcClient, holder: string): Promise<void> {
  try {
    await client.rpc('release_execution_lock', {
      p_lock_name: ENRICHMENT_LOCK,
      p_holder: holder,
    })
  } catch (err) {
    console.warn(
      `[execution-lock] release failed for ${holder} (lease will expire on its own): ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
  }
}

/**
 * Deletes ledger rows older than the retention period.
 *
 * Called opportunistically at the start of each enrichment cycle
 * rather than from a dedicated cron. That choice is deliberate: a
 * separate schedule would be one more thing to configure by hand in
 * production (and one more thing to silently never be configured,
 * which is exactly how the ledger grew unbounded in the first place).
 * Enrichment already runs 6x/day on a guaranteed schedule, so hooking
 * cleanup there makes it automatic with no additional setup.
 *
 * Never throws: cleanup is maintenance, and a failure to prune must
 * never prevent the actual enrichment work from proceeding.
 */
export async function pruneTokenLedger(client: LockRpcClient): Promise<number> {
  try {
    const { data, error } = await client.rpc('prune_ai_token_usage', {})
    if (error) {
      console.warn(`[execution-lock] ledger prune failed (non-fatal): ${error.message}`)
      return 0
    }
    return typeof data === 'number' ? data : 0
  } catch (err) {
    console.warn(
      `[execution-lock] ledger prune failed (non-fatal): ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
    return 0
  }
}
