/**
 * AIscentra — pipeline cycle metrics
 *
 * Real gap this closes: the only place ingestion/processing/latency/
 * failure data existed was ephemeral JSON in a cron HTTP response body
 * -- never persisted, so there was no way to see throughput or failure
 * trends over time without re-reading raw GitHub Actions logs one run
 * at a time.
 *
 * Deliberately minimal: one row per completed cycle (collection or
 * enrichment), written best-effort. A metrics-write failure must never
 * fail the actual pipeline work it is describing -- see
 * recordCycleMetrics's own fail-safe behavior below.
 */

export interface MetricsRpcClient {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>
  from: (table: string) => {
    insert: (
      values: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>
  }
}

export interface CycleMetrics {
  cycleType: 'collection' | 'enrichment'
  startedAt: number // Date.now() at cycle start
  completedAt: number // Date.now() at cycle end
  itemsAttempted: number
  itemsSucceeded: number
  itemsFailed: number
  failureBreakdown: Record<string, number>
  stoppedReason?: string
  /** Per-item latencies in ms, collected during this cycle -- used to
   * compute real p50/p95, not an estimate. Omit for cycle types with
   * no comparable per-item latency (e.g. collection). */
  itemLatenciesMs?: number[]
  /** Unprocessed count at the START of this cycle. */
  queueDepth?: number
  /** Age in seconds of the oldest unprocessed item at cycle start. */
  oldestPendingAgeSeconds?: number | null
}

/**
 * Real (not estimated) percentile from a list of latency samples.
 * Sorts ascending and indexes -- the same method already used
 * elsewhere in this codebase's own Groq-log analysis for the same
 * purpose, kept consistent rather than introducing a second formula.
 */
export function computePercentile(samplesMs: number[], percentile: number): number | null {
  if (samplesMs.length === 0) return null
  const sorted = [...samplesMs].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.floor((sorted.length * percentile) / 100))
  return sorted[idx] ?? null
}

/**
 * Records one completed cycle's metrics. Never throws: a failure to
 * record metrics must not fail (or appear to fail) the actual
 * collection/enrichment work already completed by the time this is
 * called -- metrics are observability, not a correctness dependency.
 */
export async function recordCycleMetrics(
  client: MetricsRpcClient,
  metrics: CycleMetrics,
): Promise<void> {
  try {
    const { error } = await client.from('pipeline_metrics').insert({
      cycle_type: metrics.cycleType,
      started_at: new Date(metrics.startedAt).toISOString(),
      completed_at: new Date(metrics.completedAt).toISOString(),
      duration_ms: metrics.completedAt - metrics.startedAt,
      items_attempted: metrics.itemsAttempted,
      items_succeeded: metrics.itemsSucceeded,
      items_failed: metrics.itemsFailed,
      failure_breakdown: metrics.failureBreakdown,
      stopped_reason: metrics.stoppedReason ?? null,
      latency_p50_ms: computePercentile(metrics.itemLatenciesMs ?? [], 50),
      latency_p95_ms: computePercentile(metrics.itemLatenciesMs ?? [], 95),
      queue_depth: metrics.queueDepth ?? null,
      oldest_pending_age_seconds: metrics.oldestPendingAgeSeconds ?? null,
    })
    if (error) {
      console.warn(`[metrics] recordCycleMetrics failed (non-fatal): ${error.message}`)
    }
  } catch (err) {
    console.warn(
      `[metrics] recordCycleMetrics threw (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}
