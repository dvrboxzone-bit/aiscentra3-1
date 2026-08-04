/**
 * AIscentra — Observatory Assistant Quota
 *
 * Two layers of protection, matching the numbers determined this
 * session from Groq's actual Free-plan rate limits
 * (llama-3.3-70b-versatile: 1,000 requests/day, shared at the
 * organization level with the Signal Engine's own enrichment
 * pipeline, which is the higher-priority consumer of that budget):
 *
 * 1. Per-IP daily cap: 15 requests/day. Prevents a single abusive
 *    client from consuming a disproportionate share.
 * 2. Global daily cap: 250 requests/day, summed across ALL IPs. Even
 *    if every individual IP stays under its own cap, many legitimate
 *    users at once could otherwise exhaust the shared Groq budget and
 *    starve the Signal Engine. This reserves the majority (~750/1000)
 *    of the daily 70b budget for the Signal Engine regardless of how
 *    much Assistant traffic there is.
 *
 * Storage: supabase/migrations/20260803120000_create_assistant_rate_limits.sql
 * (per Constitution Article 12.7 -- an in-memory limiter is not
 * sufficient protection on serverless, where instances do not share
 * memory across invocations).
 *
 * IP addresses are hashed (SHA-256 + a fixed, non-secret salt) before
 * storage -- a privacy-conscious default. This is NOT a cryptographic
 * security boundary (the salt is not a secret); its only purpose is
 * to avoid persisting raw IP addresses in a table that, while never
 * client-exposed, should still not need to store them verbatim.
 */
import { createHash } from 'crypto'

export const PER_IP_DAILY_LIMIT = 15
export const GLOBAL_DAILY_LIMIT = 250

// Not a secret -- see docstring above. Only prevents casual recovery
// of a raw IP from the stored hash, not a security control.
const IP_HASH_SALT = 'aiscentra-assistant-quota-v1'

export interface QuotaCheckResult {
  allowed: boolean
  reason?: 'per_ip' | 'global'
  perIpCount: number
  globalCount: number
}

/**
 * Extracts the client's IP from standard proxy headers. Vercel sets
 * `x-forwarded-for` (first entry is the original client); falls back
 * to `x-real-ip`, then a fixed placeholder if neither is present (a
 * local/dev request with no proxy in front of it) -- the placeholder
 * itself still participates in per-IP counting normally, it just
 * means every such request shares one bucket, which is fine for local
 * development and never occurs in the real Vercel deployment.
 */
export function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get('x-forwarded-for')
  if (forwardedFor) {
    const first = forwardedFor.split(',')[0]?.trim()
    if (first) return first
  }
  const realIp = request.headers.get('x-real-ip')
  if (realIp) return realIp
  return 'unknown-no-proxy-header'
}

export function hashIp(ip: string): string {
  return createHash('sha256').update(`${IP_HASH_SALT}:${ip}`).digest('hex')
}

/**
 * Minimal shape this module actually calls -- deliberately loose
 * (matching the existing convention in src/modules/observations/
 * queries.ts's RetryQueryClient) so a test can supply a small
 * hand-written mock without depending on Supabase's full generic
 * client types. Modeled as PromiseLike + chainable .eq(), matching
 * how Supabase's real PostgrestFilterBuilder behaves (each .eq() call
 * both returns something further chainable AND is directly awaitable).
 */
export type QuotaQueryResult = {
  data: Array<{ request_count: number }> | null
  error: { message: string } | null
}

export interface QuotaFilterBuilder extends PromiseLike<QuotaQueryResult> {
  eq: (col: string, val: string) => QuotaFilterBuilder
}

export interface QuotaQueryClient {
  from(table: string): {
    select: (columns: string) => QuotaFilterBuilder
    upsert: (
      values: Record<string, unknown>,
      opts: { onConflict: string },
    ) => {
      select: () => Promise<{ data: unknown; error: { message: string } | null }>
    }
  }
}

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Checks both quota layers and, if allowed, atomically increments the
 * per-IP counter for today. Fail-open on a database read/write error
 * (logs the error, allows the request) -- a quota-tracking outage
 * should degrade to "no quota enforced today," not "Assistant fully
 * down," since the quota exists to protect a shared cost budget, not
 * to gate access to paid functionality (this product has no paid
 * tiers at all -- see the owner's own explicit instruction that
 * everything remains free).
 */
export async function checkAndIncrementQuota(
  client: QuotaQueryClient,
  ip: string,
): Promise<QuotaCheckResult> {
  const date = todayUTC()
  const ipHash = hashIp(ip)

  try {
    const { data: allRows, error: globalError } = await client
      .from('assistant_rate_limits')
      .select('request_count')
      .eq('request_date', date)

    if (globalError) {
      console.error('[assistant-quota] global read failed, failing open:', globalError.message)
      return { allowed: true, perIpCount: 0, globalCount: 0 }
    }

    const globalCount = (allRows ?? []).reduce((sum, r) => sum + r.request_count, 0)

    if (globalCount >= GLOBAL_DAILY_LIMIT) {
      return { allowed: false, reason: 'global', perIpCount: 0, globalCount }
    }

    const { data: ipRows, error: ipError } = await client
      .from('assistant_rate_limits')
      .select('request_count')
      .eq('request_date', date)
      .eq('ip_hash', ipHash)

    if (ipError) {
      console.error('[assistant-quota] per-IP read failed, failing open:', ipError.message)
      return { allowed: true, perIpCount: 0, globalCount }
    }

    const perIpCount = ipRows?.[0]?.request_count ?? 0

    if (perIpCount >= PER_IP_DAILY_LIMIT) {
      return { allowed: false, reason: 'per_ip', perIpCount, globalCount }
    }

    const { error: upsertError } = await client
      .from('assistant_rate_limits')
      .upsert(
        {
          ip_hash: ipHash,
          request_date: date,
          request_count: perIpCount + 1,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'ip_hash,request_date' },
      )
      .select()

    if (upsertError) {
      console.error('[assistant-quota] increment failed, failing open:', upsertError.message)
      return { allowed: true, perIpCount, globalCount }
    }

    return { allowed: true, perIpCount: perIpCount + 1, globalCount: globalCount + 1 }
  } catch (err) {
    console.error(
      '[assistant-quota] unexpected error, failing open:',
      err instanceof Error ? err.message : String(err),
    )
    return { allowed: true, perIpCount: 0, globalCount: 0 }
  }
}
