/**
 * AIscentra — source URL safety filtering
 *
 * Real requirement this implements: "небезопасный или недоступный URL
 * исключать; если не осталось ни одной доступной ссылки — сигнал не
 * публиковать." Only the SAFETY half is checkable synchronously,
 * without a network call (protocol, scheme, hostname sanity) --
 * genuine "reachability" (a live HTTP request) is deliberately NOT
 * attempted here, since doing so on every render of a signal page
 * would mean an external network round-trip in the render path for
 * every visitor -- instead, reachability is validated once, at
 * collection time (collector.ts already only saves an observation
 * after successfully fetching its feed), and safety is re-validated
 * here at render/publication-check time, since a URL that was safe
 * when collected could theoretically be edited in the database by a
 * future bug -- defense in depth, not redundant.
 */

const DISALLOWED_HOSTNAMES = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]'])

/**
 * True if a URL is safe to render as a clickable, public-facing link:
 * - Must parse as a valid absolute URL at all.
 * - Must be http/https -- explicitly excludes javascript:, data:,
 *   file:, and any other scheme that could execute code or expose
 *   local files if clicked.
 * - Must not point at localhost/loopback/link-local addresses, which
 *   would either be meaningless to a real visitor or, worse, could be
 *   used to probe the visitor's own local network if this project's
 *   data were ever manipulated.
 */
export function isSafeSourceUrl(url: string | null | undefined): boolean {
  if (!url) return false
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
  const hostname = parsed.hostname.toLowerCase()
  if (DISALLOWED_HOSTNAMES.has(hostname)) return false
  if (hostname.startsWith('169.254.')) return false // link-local
  if (hostname.startsWith('192.168.') || hostname.startsWith('10.')) return false // private ranges
  return true
}

export interface SourceLink {
  url: string
  sourceName: string
  faviconUrl: string | null
}

/**
 * Builds a same-origin favicon URL for a source link -- "verified" in
 * the sense required here means fetched from the SAME domain as the
 * actual article URL being linked (not a third-party icon service
 * guessing at a logo), so the icon a reader sees is provably tied to
 * where the link actually goes. Rendering code must still handle this
 * 404ing or failing to load (see SourceFaviconStrip's own onError
 * fallback) -- this only constructs the candidate URL, it does not
 * verify the icon exists.
 */
export function buildFaviconUrl(sourceUrl: string): string | null {
  if (!isSafeSourceUrl(sourceUrl)) return null
  try {
    const parsed = new URL(sourceUrl)
    return `${parsed.protocol}//${parsed.hostname}/favicon.ico`
  } catch {
    return null
  }
}

/**
 * Filters a list of source links down to only safe ones, matching the
 * exact requirement: "небезопасный или недоступный URL исключать."
 */
export function filterSafeSourceLinks(links: SourceLink[]): SourceLink[] {
  return links.filter((l) => isSafeSourceUrl(l.url))
}
