/**
 * AIscentra — centralized cron authentication guard
 *
 * REAL GAPS this closes:
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
 * 3. THIRD ARCHITECTURAL REVIEW: the first version of this fix still
 *    branched on `providedBuf.length !== realBuf.length` BEFORE
 *    calling timingSafeEqual (required, since timingSafeEqual itself
 *    throws on mismatched-length buffers) -- but that length
 *    comparison is not itself constant-time, so it could in principle
 *    leak the real secret's LENGTH to an attacker measuring response
 *    times across many guesses of different lengths. Fixed by hashing
 *    BOTH the provided and real secret with SHA-256 first: a hash
 *    digest is always exactly 32 bytes regardless of input length, so
 *    the two buffers passed to timingSafeEqual are ALWAYS the same
 *    length -- no length-dependent branch on the secret exists
 *    anywhere in this function. This is the standard "hash-then-
 *    compare" pattern used for exactly this class of problem in
 *    HMAC-signature verification.
 */
import { timingSafeEqual, createHash } from 'node:crypto'

/**
 * True if the provided secret matches CRON_SECRET, compared via a
 * SHA-256 digest of each side (both always exactly 32 bytes,
 * regardless of the original secret's length) run through
 * crypto.timingSafeEqual. Returns false (never throws) for any
 * malformed input -- including a missing/empty provided value or a
 * missing CRON_SECRET env var, both treated as "not authorized" rather
 * than a crash.
 */
export function verifyCronSecret(providedSecret: string | null | undefined): boolean {
  const realSecret = process.env['CRON_SECRET']
  if (!realSecret || !providedSecret) return false

  // Hash first: digests are always 32 bytes for SHA-256 regardless of
  // input length, so there is no length-dependent branch on the
  // SECRET anywhere below -- timingSafeEqual always receives two
  // equal-length (32-byte) buffers and can run unconditionally.
  const providedHash = createHash('sha256').update(providedSecret, 'utf8').digest()
  const realHash = createHash('sha256').update(realSecret, 'utf8').digest()

  return timingSafeEqual(providedHash, realHash)
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
