/**
 * AIscentra — centralized cron authentication guard
 *
 * REAL GAPS this closes (second architectural review):
 * 1. Every cron route implemented its own `!==` string comparison
 *    against CRON_SECRET. String `!==` short-circuits on the first
 *    mismatched byte, making the comparison time variable with how
 *    many leading bytes of a guess happen to match the real secret --
 *    a textbook timing side-channel. crypto.timingSafeEqual runs in
 *    constant time regardless of where (or whether) the inputs differ.
 * 2. The check was duplicated across every cron route file
 *    independently -- a single missed or subtly-wrong copy in a future
 *    route would silently reintroduce the vulnerability. Centralized
 *    here so there is exactly one implementation to get right.
 */
import { timingSafeEqual } from 'node:crypto'

/**
 * True if the provided secret matches CRON_SECRET, compared in
 * constant time. Returns false (never throws) for any malformed input
 * -- including a missing/empty provided value or a missing
 * CRON_SECRET env var, both treated as "not authorized" rather than a
 * crash.
 */
export function verifyCronSecret(providedSecret: string | null | undefined): boolean {
  const realSecret = process.env['CRON_SECRET']
  if (!realSecret || !providedSecret) return false

  const providedBuf = Buffer.from(providedSecret)
  const realBuf = Buffer.from(realSecret)

  // timingSafeEqual throws if the buffers have different lengths --
  // that length check itself is not constant-time, but leaking
  // "the guess was the wrong length" is a vastly smaller signal than
  // leaking "the first N bytes happened to match," which is what a
  // naive `!==` comparison exposes byte-by-byte across many requests.
  if (providedBuf.length !== realBuf.length) return false

  return timingSafeEqual(providedBuf, realBuf)
}

/**
 * Extracts the caller-provided secret from either the standard
 * `Authorization: Bearer <secret>` header (used by GitHub Actions
 * workflows in this project) or the legacy `x-cron-secret` header
 * (used by a couple of older internal routes) -- checked by name so
 * callers do not need to know which convention a given route expects.
 */
export function extractCronSecret(request: Request): string | null {
  const authHeader = request.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) return authHeader.slice('Bearer '.length)

  return request.headers.get('x-cron-secret')
}

/**
 * Convenience combining both steps: true if the request carries a
 * valid cron secret via either supported header.
 */
export function isAuthorizedCronRequest(request: Request): boolean {
  return verifyCronSecret(extractCronSecret(request))
}
