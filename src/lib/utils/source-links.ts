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
 *
 * REAL SSRF GAPS FOUND AND FIXED HERE (architectural review):
 * 1. The original private-IP check only matched a few literal string
 *    prefixes ('192.168.', '10.', '169.254.') -- it missed the entire
 *    172.16.0.0/12 private range, and did no numeric octet comparison
 *    at all (so "010.0.0.1" or any non-dotted-decimal IPv4 form was
 *    never caught).
 * 2. IPv6 was essentially unhandled: no fc00::/7 (unique local),
 *    fe80::/10 (link-local), or ::1 (loopback, beyond one literal
 *    string). Critically, IPv4-mapped IPv6 addresses
 *    (::ffff:127.0.0.1) -- and their HEX-NORMALIZED form
 *    (::ffff:7f00:1), which is what Node's own URL parser actually
 *    produces internally -- were not decoded and checked against the
 *    IPv4 ranges at all. This is a real, documented, actively
 *    exploited SSRF bypass class (confirmed via current CVE/advisory
 *    research, not assumed).
 * 3. verifyUrlReachable used `redirect: 'follow'`, meaning a URL that
 *    passed the safety check could redirect to an internal address
 *    (e.g. a cloud metadata endpoint) and fetch() would follow it
 *    without ever re-validating the redirect TARGET's safety.
 *
 * HONEST LIMITATION, stated directly rather than overclaimed: this is
 * hostname/IP-literal-based validation, not full DNS-rebinding
 * protection. A hostname that resolves to a public IP at validation
 * time but a private IP at actual TCP-connect time (classic DNS
 * rebinding) is not defended against here -- that requires a custom
 * http.Agent with per-request DNS pinning, a materially larger
 * architectural change judged out of scope for this point fix. What
 * IS fixed: the specific, confirmed gaps above (IPv4 range coverage,
 * IPv6 including IPv4-mapped/hex forms, and redirect-target
 * revalidation).
 */

import { lookup as dnsLookup } from 'node:dns/promises'
import { Agent as UndiciAgent, fetch as undiciFetch, type Response as UndiciResponse } from 'undici'

/**
 * True if a numeric IPv4 address (already parsed into 4 octets) falls
 * in ANY non-public IANA special-purpose range -- private, loopback,
 * link-local, reserved, multicast, broadcast, or documentation/
 * benchmark ranges that must never be treated as a real, reachable
 * public destination.
 *
 * THIRD ARCHITECTURAL REVIEW: the earlier version only covered
 * private/loopback/link-local/CGNAT. Extended to the FULL IANA
 * "IPv4 Special-Purpose Address Registry" so the denylist covers every
 * non-public range, not just the commonly-cited private ones.
 */
function isPrivateIPv4Octets(o: [number, number, number, number]): boolean {
  const [a, b, c] = o
  if (a === 127) return true // 127.0.0.0/8 loopback
  if (a === 10) return true // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12
  if (a === 192 && b === 168) return true // 192.168.0.0/16
  if (a === 169 && b === 254) return true // 169.254.0.0/16 link-local
  if (a === 0) return true // 0.0.0.0/8 "this network"
  if (a === 100 && b >= 64 && b <= 127) return true // 100.64.0.0/10 CGNAT
  if (a === 192 && b === 0 && c === 0) return true // 192.0.0.0/24 IETF protocol assignments
  if (a === 192 && b === 0 && c === 2) return true // 192.0.2.0/24 TEST-NET-1
  if (a === 192 && b === 88 && c === 99) return true // 192.88.99.0/24 6to4 relay anycast
  if (a === 198 && b >= 18 && b <= 19) return true // 198.18.0.0/15 benchmarking
  if (a === 198 && b === 51 && c === 100) return true // 198.51.100.0/24 TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true // 203.0.113.0/24 TEST-NET-3
  if (a >= 224 && a <= 239) return true // 224.0.0.0/4 multicast
  if (a >= 240) return true // 240.0.0.0/4 reserved (includes 255.255.255.255/32 broadcast)
  return false
}

/** Parses a dotted-decimal IPv4 string into 4 octets, or null if not
 * a valid, purely-numeric dotted-decimal IPv4 address (deliberately
 * rejects any non-standard form -- octal, hex, decimal-integer, or
 * short forms like "127.1" -- as unsafe-to-parse rather than trying
 * to fully normalize every historical IPv4 notation). */
function parseIPv4(host: string): [number, number, number, number] | null {
  const parts = host.split('.')
  if (parts.length !== 4) return null
  const octets: number[] = []
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const n = Number(part)
    if (n > 255) return null
    octets.push(n)
  }
  return octets as [number, number, number, number]
}

/**
 * True if a hostname (as returned by URL.hostname, which Node already
 * normalizes -- including collapsing IPv4-mapped IPv6 forms to their
 * hex representation, e.g. "::ffff:7f00:1") resolves to a private,
 * loopback, or link-local address, covering both IPv4 and IPv6
 * literal forms, INCLUDING IPv4-mapped IPv6 in both dotted and
 * hex-normalized notation -- the specific, confirmed bypass class
 * found during review.
 */
/**
 * Parses any valid textual IPv6 address (canonical/compressed,
 * fully-expanded, mixed-case, non-maximal zero-run, or with an
 * IPv4-mapped dotted-quad tail) into a single 128-bit BigInt.
 * Returns null for anything that does not parse as a valid IPv6
 * address.
 *
 * FOURTH ARCHITECTURAL REVIEW: replaces the earlier string-prefix
 * checks (`ipv6.startsWith('100::')`, ad-hoc regexes like
 * `/^ff[0-9a-f]{2}:/`) entirely. Those relied on the STRING already
 * being in the specific canonical form Node's URL parser happens to
 * produce -- correct for the inputs tested, but not a genuine
 * network-layer guarantee, and fragile against any expanded,
 * padded, or otherwise non-canonical textual form reaching this
 * function by a path other than `new URL(...).hostname` (e.g. a
 * future caller passing a raw resolved DNS address string directly).
 * Real, robust fix: parse into a full 128-bit numeric value and do
 * genuine bitwise CIDR (network/prefix-length) comparison -- the
 * same technique any correct IP-range library uses, immune to
 * textual formatting entirely.
 */
function parseIPv6ToBigInt(input: string): bigint | null {
  let s = input.toLowerCase()
  if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1)

  // IPv4-mapped/embedded dotted-quad tail (e.g. "::ffff:127.0.0.1" or
  // "64:ff9b::127.0.0.1") -- convert the trailing dotted-quad into its
  // two equivalent 16-bit hex groups before general parsing.
  const dottedTailMatch = /^(.*:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(s)
  if (dottedTailMatch?.[1] && dottedTailMatch[2]) {
    const octets = parseIPv4(dottedTailMatch[2])
    if (!octets) return null
    const [a, b, c, d] = octets
    const word1 = ((a << 8) | b).toString(16)
    const word2 = ((c << 8) | d).toString(16)
    s = `${dottedTailMatch[1]}${word1}:${word2}`
  }

  if ((s.match(/::/g) ?? []).length > 1) return null // at most one "::" is valid

  let left: string[]
  let right: string[]
  if (s.includes('::')) {
    const [l, r] = s.split('::')
    left = l ? l.split(':') : []
    right = r ? r.split(':') : []
  } else {
    left = s.split(':')
    right = []
  }

  const totalExplicit = left.length + right.length
  if (totalExplicit > 8) return null
  const missing = 8 - totalExplicit
  if (!s.includes('::') && missing !== 0) return null // no compression, must be exactly 8 groups

  const groups = [...left, ...Array(missing).fill('0'), ...right]
  if (groups.length !== 8) return null

  let value = 0n
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null
    value = (value << 16n) | BigInt(parseInt(g, 16))
  }
  return value
}

interface Ipv6Range {
  network: bigint
  prefixBits: number
  name: string
}

function cidr6(address: string, prefixBits: number, name: string): Ipv6Range {
  const network = parseIPv6ToBigInt(address)
  if (network === null) throw new Error(`invalid IPv6 literal in denylist definition: ${address}`)
  return { network, prefixBits, name }
}

/**
 * Full IANA "IPv6 Special-Purpose Address Registry" coverage,
 * expressed as genuine CIDR ranges (network + prefix length),
 * compared via real bitwise masking -- not string matching.
 *
 * FIFTH ARCHITECTURAL REVIEW: ::ffff:0:0/96 (IPv4-mapped) and
 * 2002::/16 (6to4) are now BOTH present here for complete registry
 * coverage/auditability -- IANA lists ::ffff:0:0/96 as non-global.
 * The IPv4-mapped range's embedded address is still correctly
 * unwrapped and checked on its own merits FIRST in
 * isPrivateOrLoopbackHost below (so ::ffff:8.8.8.8, embedding a real
 * public address, is still allowed) -- this entry exists so the
 * table itself documents every registry range, while the actual
 * decision for that specific range is resolved by the dedicated
 * unwrap-then-check logic before the general denylist loop ever runs
 * for it. 2002::/16 (6to4) is a genuine blanket reject: 6to4 was
 * formally deprecated by RFC 7526 (2015) due to widespread relay
 * abuse/reachability problems, so -- unlike IPv4-mapped and NAT64,
 * which remain actively-used, well-behaved mechanisms -- no
 * embedded-address carve-out is applied for it.
 */
const IPV6_DENYLIST: Ipv6Range[] = [
  cidr6('::', 128, 'unspecified'),
  cidr6('::1', 128, 'loopback'),
  cidr6(
    '::ffff:0:0',
    96,
    'IPv4-mapped (non-global per IANA; embedded address unwrapped and re-checked separately below)',
  ),
  cidr6('64:ff9b::', 96, 'NAT64 well-known prefix'),
  cidr6('64:ff9b:1::', 48, 'NAT64 local-use prefix'),
  cidr6('100::', 64, 'discard-only'),
  cidr6('100:0:0:1::', 64, 'dummy IPv6 prefix'),
  cidr6('2001::', 23, 'IETF protocol assignments'),
  cidr6('2001:2::', 48, 'benchmarking'),
  cidr6('2001:db8::', 32, 'documentation'),
  cidr6(
    '2002::',
    16,
    '6to4 (deprecated, RFC 7526 -- blanket reject, no embedded-address carve-out)',
  ),
  cidr6('3fff::', 20, 'documentation (RFC 9637)'),
  cidr6('5f00::', 16, 'former 6bone space (reserved)'),
  cidr6('fc00::', 7, 'unique-local'),
  cidr6('fe80::', 10, 'link-local'),
  cidr6('ff00::', 8, 'multicast'),
]

/** Prefix bits reserved for the IPv4-mapped range, ::ffff:0:0/96 --
 * used to test membership BEFORE the general denylist loop, so the
 * embedded-address unwrap-and-recheck logic always runs first for
 * this specific range regardless of its own presence in
 * IPV6_DENYLIST above. Computed directly (not via parseIPv6ToBigInt)
 * so its type is a plain bigint, not bigint | null -- the value
 * itself (top 96 bits = 0xffff, matching ::ffff:0:0's own definition)
 * is a fixed constant, not user input.
 */
const IPV4_MAPPED_PREFIX_TOP32 = 0xffffn

function isIPv4Mapped(addressValue: bigint): boolean {
  return addressValue >> 32n === IPV4_MAPPED_PREFIX_TOP32
}

function isPrivateIPv6(addressValue: bigint): boolean {
  for (const range of IPV6_DENYLIST) {
    const shift = BigInt(128 - range.prefixBits)
    if (addressValue >> shift === range.network >> shift) return true
  }
  return false
}

function isPrivateOrLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase()

  // Plain IPv4 literal.
  const ipv4 = parseIPv4(h)
  if (ipv4 && isPrivateIPv4Octets(ipv4)) return true

  // IPv6 forms. URL.hostname wraps IPv6 in brackets in the ORIGINAL
  // input but reports it WITHOUT brackets via .hostname in Node's URL
  // implementation -- parseIPv6ToBigInt strips brackets defensively
  // regardless.
  const ipv6Value = parseIPv6ToBigInt(h)
  if (ipv6Value !== null) {
    // FIFTH ARCHITECTURAL REVIEW: IPv4-mapped addresses (::ffff:0:0/96)
    // are checked FIRST, unconditionally, before the general IPv6
    // denylist loop -- this range's own entry in IPV6_DENYLIST exists
    // for registry-completeness documentation, but the REAL decision
    // for any address in this range is made here, by unwrapping the
    // embedded IPv4 and checking IT on its own merits. This correctly
    // allows ::ffff:8.8.8.8 (embeds a genuinely public address) while
    // still rejecting ::ffff:127.0.0.1 (embeds a private address) --
    // a blanket reject of the whole /96 (matching IANA's own
    // "Global: False" flag literally) would incorrectly reject the
    // former.
    if (isIPv4Mapped(ipv6Value)) {
      const embeddedIpv4 = ipv6Value & 0xffffffffn
      const octets: [number, number, number, number] = [
        Number((embeddedIpv4 >> 24n) & 0xffn),
        Number((embeddedIpv4 >> 16n) & 0xffn),
        Number((embeddedIpv4 >> 8n) & 0xffn),
        Number(embeddedIpv4 & 0xffn),
      ]
      return isPrivateIPv4Octets(octets)
    }

    // Not IPv4-mapped -- the general IANA denylist applies, including
    // 2002::/16 (6to4), which IS a genuine blanket reject here (see
    // IPV6_DENYLIST's own docstring for why no carve-out applies to
    // it, unlike IPv4-mapped/NAT64).
    if (isPrivateIPv6(ipv6Value)) return true
  }

  return false
}

const DISALLOWED_HOSTNAMES = new Set(['localhost'])

/**
 * True if a URL is safe to render as a clickable, public-facing link,
 * or to fetch for reachability verification:
 * - Must parse as a valid absolute URL at all.
 * - Must be http/https -- explicitly excludes javascript:, data:,
 *   file:, and any other scheme that could execute code or expose
 *   local files if clicked.
 * - Must not resolve (as a literal, see isPrivateOrLoopbackHost) to a
 *   private/loopback/link-local address, IPv4 or IPv6, including
 *   IPv4-mapped IPv6 in either notation.
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
  if (isPrivateOrLoopbackHost(hostname)) return false
  return true
}

export interface SourceLink {
  url: string
  sourceName: string
  faviconUrl: string | null
}

/**
 * Real requirement: "хранить результат и время проверки URL; не
 * выполнять внешний запрос при каждом render." This function performs
 * the ONE real network check -- called exactly once per observation
 * (see /api/cron/verify-urls), never at render time. The result is
 * stored and read back, never re-checked per page view.
 *
 * REAL SSRF FIX: redirects are no longer auto-followed
 * (`redirect: 'manual'`). Each redirect target is extracted from the
 * Location header and re-validated through the SAME isSafeSourceUrl
 * check before being followed -- a URL that is safe itself but
 * redirects to an internal address (e.g. a cloud metadata endpoint)
 * is now correctly rejected rather than silently followed. Bounded to
 * a small number of hops to avoid an unbounded redirect chain.
 */
const MAX_REDIRECT_HOPS = 5

/**
 * Real requirement: "хранить результат и время проверки URL; не
 * выполнять внешний запрос при каждом render." This function performs
 * the ONE real network check -- called exactly once per observation
 * (see /api/cron/verify-urls), never at render time. The result is
 * stored and read back, never re-checked per page view.
 *
 * REAL DNS-REBINDING FIX (second architectural review): the earlier
 * version validated only the URL's HOSTNAME string (or IP literal) --
 * for a genuine domain name, no DNS resolution ever happened here at
 * all. isSafeSourceUrl passing a hostname string proves NOTHING about
 * what IP that hostname actually resolves to. This is the textbook
 * DNS-rebinding gap: an attacker's domain can return a safe public IP
 * to a check performed at one moment, then return a private/internal
 * IP to the ACTUAL fetch() a moment later (the DNS TTL can be set to 0
 * for exactly this purpose) -- fetch() does its own independent DNS
 * resolution at connect time, completely bypassing any earlier
 * hostname-string check.
 *
 * Fixed with genuine DNS pinning, not just an earlier check:
 * 1. Explicitly resolve the hostname via dns.promises.lookup (all
 *    addresses, not just the first).
 * 2. Reject if ANY resolved address is private/reserved (an attacker
 *    could return multiple A/AAAA records and rely on the client
 *    picking the "safe-looking" one).
 * 3. Build an undici Agent with a `connect.lookup` override that
 *    returns ONLY the already-validated IP -- the actual TCP
 *    connection is forced to that exact address. No second,
 *    independent DNS resolution ever happens at connect time, closing
 *    the check-then-use gap that makes rebinding possible.
 * 4. Every redirect hop repeats this ENTIRE process (fresh resolve,
 *    fresh validation, fresh pinned Agent) for the new hostname --
 *    Location headers are never treated as pre-validated.
 */
export type DnsLookupFn = (
  hostname: string,
  options: { all: true; verbatim: true },
) => Promise<{ address: string; family: number }[]>

/**
 * Real, live DNS resolver used in production. Tests inject a fake
 * implementation via verifyUrlReachable's own optional parameter
 * (see below) -- this keeps adversarial DNS-rebinding tests fully
 * deterministic and portable (no /etc/hosts or real network DNS
 * dependency in CI), while production always uses this real resolver.
 */
const realDnsLookup: DnsLookupFn = dnsLookup as unknown as DnsLookupFn

async function resolveAndPinIp(
  hostname: string,
  lookupFn: DnsLookupFn,
  timeoutMs: number,
): Promise<string | null> {
  if (timeoutMs <= 0) return null // no budget remains -- fail closed, never start new work

  let addresses: { address: string; family: number }[]
  try {
    // REAL FIX (production incident): DNS resolution previously had NO
    // timeout at all -- a slow-resolving hostname could stall the
    // entire call indefinitely, well past what the caller's own
    // deadline implied. Raced against the remaining budget so a slow
    // DNS lookup fails closed rather than hanging.
    addresses = await Promise.race([
      lookupFn(hostname, { all: true, verbatim: true }),
      new Promise<never>((_resolve, reject) => {
        setTimeout(
          () => reject(new Error('DNS resolution exceeded remaining time budget')),
          timeoutMs,
        )
      }),
    ])
  } catch {
    return null // resolution failure (including a timeout) -- cannot be verified as safe, fail closed
  }
  if (addresses.length === 0) return null
  for (const { address } of addresses) {
    if (isPrivateOrLoopbackHost(address)) return null // ANY unsafe resolved address rejects the whole hostname
  }
  return addresses[0]?.address ?? null
}

function buildPinnedAgent(pinnedIp: string, family: number): InstanceType<typeof UndiciAgent> {
  return new UndiciAgent({
    connect: {
      // Real DNS pin: this `lookup` override is what the TCP socket
      // actually connects to -- it is NOT a second, independent DNS
      // resolution, so nothing can change between validation and
      // connection.
      lookup: (_hostname, _options, callback) => {
        callback(null, [{ address: pinnedIp, family }])
      },
    },
  })
}

/**
 * Minimal shape of the fetch call this function needs -- injectable so
 * adversarial redirect tests can simulate HTTP responses (status
 * codes, Location headers) deterministically, without needing a real
 * reachable server. Defaults to the real undici fetch in production.
 * The DNS-pinning Agent is still always built and passed for every
 * call, real or injected -- a test's fake fetchFn receives the SAME
 * pinned dispatcher a real request would, so tests exercise the real
 * per-hop pin/re-resolve structure, only the actual network I/O is
 * swapped out.
 */
export type FetchFn = (
  url: string,
  init: RequestInit & { dispatcher?: unknown },
) => Promise<UndiciResponse>

const realFetch: FetchFn = undiciFetch as unknown as FetchFn

/**
 * REAL BUG FIXED (production incident: FUNCTION_INVOCATION_TIMEOUT
 * during a priority-backfill run): the earlier version reset a fresh
 * timeoutMs timer on EVERY redirect hop's fetch call, applied NO
 * timeout at all to DNS resolution, and started an entirely FRESH set
 * of timers again for the GET fallback after HEAD. Worst case: up to
 * MAX_REDIRECT_HOPS=5 hops x (unbounded DNS + timeoutMs fetch) for
 * HEAD, then the SAME again for GET -- a single URL check could take
 * far longer than timeoutMs ever implied, and a page of PAGE_SIZE
 * concurrent checks (Promise.all waits for the slowest) could push
 * the whole request well past the endpoint's own maxDuration, exactly
 * what happened in production.
 *
 * Fixed with a genuine SINGLE absolute deadline for the entire call --
 * DNS resolution, every redirect hop, HEAD, and the GET fallback all
 * share the SAME deadline, computed once at the start. Every internal
 * operation is bounded by the REMAINING time until that deadline, not
 * a fresh per-step timer -- the timer is never restarted.
 */
export async function verifyUrlReachable(
  url: string,
  timeoutMs = 5_000,
  lookupFn: DnsLookupFn = realDnsLookup,
  fetchFn: FetchFn = realFetch,
): Promise<boolean> {
  if (!isSafeSourceUrl(url)) return false

  const deadlineAt = Date.now() + timeoutMs

  const attempt = async (method: 'HEAD' | 'GET', targetUrl: string): Promise<boolean> => {
    let currentUrl = targetUrl
    for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
      const remainingMs = deadlineAt - Date.now()
      if (remainingMs <= 0) return false // the single absolute deadline is already spent -- never start new work

      if (!isSafeSourceUrl(currentUrl)) return false // string-level check, every hop

      let hostname: string
      try {
        hostname = new URL(currentUrl).hostname
      } catch {
        return false
      }

      // REAL FIX: DNS resolution is now bounded by the SAME remaining
      // budget -- previously entirely unbounded, on every hop.
      const pinnedIp = await resolveAndPinIp(hostname, lookupFn, remainingMs)
      if (!pinnedIp) return false // unresolvable, unsafe, or DNS itself timed out -- fail closed

      const family = pinnedIp.includes(':') ? 6 : 4
      const agent = buildPinnedAgent(pinnedIp, family)

      const fetchBudgetMs = deadlineAt - Date.now()
      if (fetchBudgetMs <= 0) {
        await agent.close().catch(() => {})
        return false
      }

      try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), fetchBudgetMs) // REAL FIX: bounded by remaining budget, not a fresh timeoutMs
        let res: UndiciResponse
        try {
          res = await fetchFn(currentUrl, {
            method,
            redirect: 'manual',
            signal: controller.signal,
            headers: method === 'GET' ? { Range: 'bytes=0-0' } : {},
            dispatcher: agent,
          })
        } finally {
          clearTimeout(timer)
          await agent.close().catch(() => {})
        }

        if (res.status >= 200 && res.status < 300) return true
        if (res.status >= 300 && res.status < 400) {
          const location = res.headers.get('location')
          if (!location) return false
          try {
            currentUrl = new URL(location, currentUrl).toString()
          } catch {
            return false
          }
          continue // re-validate AND re-resolve the NEW target at the top of the loop, same deadline
        }
        return false // 4xx/5xx -- not genuinely reachable
      } catch {
        return false
      }
    }
    return false // exceeded MAX_REDIRECT_HOPS
  }

  if (await attempt('HEAD', url)) return true
  // Some origins reject HEAD specifically (405/501) but serve GET
  // fine -- one bounded retry, not a silent false negative. Uses the
  // SAME absolute deadlineAt -- not a fresh timeoutMs budget.
  if (deadlineAt - Date.now() <= 0) return false
  return attempt('GET', url)
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
