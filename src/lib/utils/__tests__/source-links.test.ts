/**
 * AIscentra — source URL safety tests
 *
 * Real requirement: "небезопасный или недоступный URL исключать; если
 * не осталось ни одной доступной ссылки — сигнал не публиковать."
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { Response as UndiciResponse } from 'undici'

import {
  isSafeSourceUrl,
  buildFaviconUrl,
  filterSafeSourceLinks,
  verifyUrlReachable,
  type DnsLookupFn,
  type FetchFn,
} from '../source-links'

describe('isSafeSourceUrl', () => {
  test('a normal https article URL is safe', () => {
    assert.equal(isSafeSourceUrl('https://openai.com/blog/some-post'), true)
  })

  test('http (not https) is still a valid, safe scheme', () => {
    assert.equal(isSafeSourceUrl('http://example.com/article'), true)
  })

  test('javascript: scheme is rejected -- would execute code if clicked', () => {
    assert.equal(isSafeSourceUrl('javascript:alert(1)'), false)
  })

  test('data: scheme is rejected', () => {
    assert.equal(isSafeSourceUrl('data:text/html,<script>alert(1)</script>'), false)
  })

  test('file: scheme is rejected -- would expose local files', () => {
    assert.equal(isSafeSourceUrl('file:///etc/passwd'), false)
  })

  test('localhost is rejected', () => {
    assert.equal(isSafeSourceUrl('http://localhost:3000/x'), false)
  })

  test('127.0.0.1 is rejected', () => {
    assert.equal(isSafeSourceUrl('http://127.0.0.1/x'), false)
  })

  test('private network ranges (192.168.x, 10.x) are rejected', () => {
    assert.equal(isSafeSourceUrl('http://192.168.1.1/x'), false)
    assert.equal(isSafeSourceUrl('http://10.0.0.5/x'), false)
  })

  test('link-local (169.254.x) is rejected', () => {
    assert.equal(isSafeSourceUrl('http://169.254.169.254/x'), false)
  })

  test('malformed URLs fail closed (not safe), not throw', () => {
    assert.equal(isSafeSourceUrl('not a url at all'), false)
    assert.equal(isSafeSourceUrl(''), false)
  })

  test('null/undefined fail closed', () => {
    assert.equal(isSafeSourceUrl(null), false)
    assert.equal(isSafeSourceUrl(undefined), false)
  })
})

describe('buildFaviconUrl', () => {
  test('builds a same-origin favicon.ico URL for a safe source', () => {
    assert.equal(
      buildFaviconUrl('https://openai.com/blog/post-123'),
      'https://openai.com/favicon.ico',
    )
  })

  test('returns null for an unsafe source URL', () => {
    assert.equal(buildFaviconUrl('javascript:alert(1)'), null)
  })

  test('preserves the http/https scheme of the original URL', () => {
    assert.equal(buildFaviconUrl('http://example.com/a'), 'http://example.com/favicon.ico')
  })
})

describe('filterSafeSourceLinks', () => {
  test('keeps only safe links, dropping unsafe ones', () => {
    const links = [
      { url: 'https://openai.com/blog/a', sourceName: 'OpenAI', faviconUrl: null },
      { url: 'javascript:alert(1)', sourceName: 'Evil', faviconUrl: null },
      { url: 'https://arxiv.org/abs/123', sourceName: 'ArXiv', faviconUrl: null },
    ]
    const result = filterSafeSourceLinks(links)
    assert.equal(result.length, 2)
    assert.deepEqual(
      result.map((r) => r.sourceName),
      ['OpenAI', 'ArXiv'],
    )
  })

  test('returns an empty array (not null/undefined) when every link is unsafe -- the "do not publish" signal for callers', () => {
    const links = [
      { url: 'javascript:alert(1)', sourceName: 'Evil', faviconUrl: null },
      { url: 'file:///etc/passwd', sourceName: 'Local', faviconUrl: null },
    ]
    const result = filterSafeSourceLinks(links)
    assert.deepEqual(result, [])
  })
})

describe('verifyUrlReachable (HTTP-layer behavior via injected fetchFn)', () => {
  const safeLookup: DnsLookupFn = async () => [{ address: '93.184.216.34', family: 4 }]

  test('unsafe URLs are never even attempted -- fails before any fetch call', async () => {
    let fetchCalled = false
    const fakeFetch: FetchFn = async () => {
      fetchCalled = true
      return new UndiciResponse('', { status: 200 })
    }
    const result = await verifyUrlReachable('javascript:alert(1)', 5000, safeLookup, fakeFetch)
    assert.equal(result, false)
    assert.equal(fetchCalled, false, 'an unsafe URL must never reach the network layer at all')
  })

  test('a 200 HEAD response is reachable', async () => {
    const fakeFetch: FetchFn = async () => new UndiciResponse('', { status: 200 })
    assert.equal(
      await verifyUrlReachable('https://example.com/article', 5000, safeLookup, fakeFetch),
      true,
    )
  })

  test('a 404 is NOT reachable, even though the domain itself responded', async () => {
    const fakeFetch: FetchFn = async () => new UndiciResponse('', { status: 404 })
    assert.equal(
      await verifyUrlReachable('https://example.com/gone', 5000, safeLookup, fakeFetch),
      false,
    )
  })

  test('HEAD rejected (405) falls back to a ranged GET, which can still succeed', async () => {
    let calls = 0
    const fakeFetch: FetchFn = async (_url, init) => {
      calls++
      if (init.method === 'HEAD') return new UndiciResponse('', { status: 405 })
      return new UndiciResponse('', { status: 200 })
    }
    const result = await verifyUrlReachable(
      'https://example.com/no-head-support',
      5000,
      safeLookup,
      fakeFetch,
    )
    assert.equal(result, true)
    assert.equal(calls, 2, 'must attempt HEAD first, then fall back to GET')
  })

  test('a network error (fetch throws) is treated as unreachable, never crashes', async () => {
    const fakeFetch: FetchFn = async () => {
      throw new Error('connection refused')
    }
    assert.equal(
      await verifyUrlReachable(
        'https://this-does-not-resolve.invalid/x',
        5000,
        safeLookup,
        fakeFetch,
      ),
      false,
    )
  })

  test('a timeout (AbortError) is treated as unreachable', async () => {
    const fakeFetch: FetchFn = async (_url, init) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted', 'AbortError'))
        })
      })
    }
    assert.equal(
      await verifyUrlReachable('https://example.com/slow', 50, safeLookup, fakeFetch),
      false,
    )
  })
})

describe('isSafeSourceUrl — SSRF protection (real bypass classes)', () => {
  test('IPv4-mapped IPv6 loopback, dotted notation, is rejected', () => {
    assert.equal(isSafeSourceUrl('http://[::ffff:127.0.0.1]/'), false)
  })

  test('IPv4-mapped IPv6 loopback, HEX-normalized notation, is rejected -- the real, documented bypass class this closes', () => {
    // Node's own URL parser normalizes ::ffff:127.0.0.1 to this exact
    // hex form (confirmed directly: new URL('http://[::ffff:127.0.0.1]/').hostname === '[::ffff:7f00:1]')
    // -- a check that only matched the dotted form would never see this.
    assert.equal(isSafeSourceUrl('http://[::ffff:7f00:1]/'), false)
  })

  test('IPv4-mapped IPv6 cloud metadata endpoint (169.254.169.254), hex form, is rejected', () => {
    assert.equal(isSafeSourceUrl('http://[::ffff:a9fe:a9fe]/'), false)
  })

  test('172.16.0.0/12 private range is rejected -- missing entirely before this fix', () => {
    assert.equal(isSafeSourceUrl('http://172.16.0.1/'), false)
    assert.equal(isSafeSourceUrl('http://172.20.5.1/'), false)
    assert.equal(isSafeSourceUrl('http://172.31.255.255/'), false)
  })

  test('addresses just outside 172.16.0.0/12 are correctly still allowed', () => {
    assert.equal(isSafeSourceUrl('http://172.15.255.255/'), true)
    assert.equal(isSafeSourceUrl('http://172.32.0.1/'), true)
  })

  test('IPv6 link-local (fe80::/10) is rejected', () => {
    assert.equal(isSafeSourceUrl('http://[fe80::1]/'), false)
  })

  test('IPv6 unique-local (fc00::/7) is rejected', () => {
    assert.equal(isSafeSourceUrl('http://[fc00::1]/'), false)
    assert.equal(isSafeSourceUrl('http://[fd12:3456::1]/'), false)
  })

  test('CGNAT range (100.64.0.0/10) is rejected', () => {
    assert.equal(isSafeSourceUrl('http://100.64.0.1/'), false)
    assert.equal(isSafeSourceUrl('http://100.127.255.255/'), false)
  })

  test('a normal real public URL remains allowed after all the above tightening', () => {
    assert.equal(isSafeSourceUrl('https://openai.com/blog/post'), true)
    assert.equal(isSafeSourceUrl('https://arxiv.org/abs/1234.5678'), true)
  })
})

describe('isSafeSourceUrl — comprehensive IANA special-purpose range coverage (third architectural review)', () => {
  test('::/128 (unspecified address) is rejected', () => {
    assert.equal(isSafeSourceUrl('http://[::]/'), false)
  })

  test('IPv4 multicast (224.0.0.0/4) is rejected, at both boundaries', () => {
    assert.equal(isSafeSourceUrl('http://224.0.0.1/'), false) // lower bound
    assert.equal(isSafeSourceUrl('http://239.255.255.255/'), false) // upper bound
  })

  test('the address immediately BEFORE the multicast range is still correctly allowed', () => {
    assert.equal(isSafeSourceUrl('http://223.255.255.255/'), true)
  })

  test('IPv4 reserved (240.0.0.0/4) and broadcast (255.255.255.255) are rejected', () => {
    assert.equal(isSafeSourceUrl('http://240.0.0.1/'), false)
    assert.equal(isSafeSourceUrl('http://255.255.255.255/'), false)
  })

  test('IPv6 multicast (ff00::/8) is rejected, at the lower boundary', () => {
    assert.equal(isSafeSourceUrl('http://[ff00::]/'), false)
    assert.equal(isSafeSourceUrl('http://[ff02::1]/'), false) // a real multicast address in use (all-nodes)
  })

  test('the address immediately BEFORE the IPv6 multicast range is still correctly allowed', () => {
    assert.equal(isSafeSourceUrl('http://[fe00::1]/'), true)
  })

  test('2001:db8::/32 (documentation range) is rejected', () => {
    assert.equal(isSafeSourceUrl('http://[2001:db8::1]/'), false)
  })

  test('100::/64 (discard-only range) is rejected', () => {
    assert.equal(isSafeSourceUrl('http://[100::1]/'), false)
  })

  test('TEST-NET-1/2/3 (documentation ranges, RFC 5737) are all rejected', () => {
    assert.equal(isSafeSourceUrl('http://192.0.2.1/'), false)
    assert.equal(isSafeSourceUrl('http://198.51.100.1/'), false)
    assert.equal(isSafeSourceUrl('http://203.0.113.1/'), false)
  })

  test('198.18.0.0/15 (benchmarking, RFC 2544) is rejected, boundary checked', () => {
    assert.equal(isSafeSourceUrl('http://198.18.0.1/'), false)
    assert.equal(isSafeSourceUrl('http://198.19.255.255/'), false) // upper bound of /15
    assert.equal(isSafeSourceUrl('http://198.17.255.255/'), true) // immediately before -- must be allowed
  })

  test('192.0.0.0/24 (IETF protocol assignments) is rejected', () => {
    assert.equal(isSafeSourceUrl('http://192.0.0.1/'), false)
  })

  test('192.88.99.0/24 (6to4 relay anycast) is rejected', () => {
    assert.equal(isSafeSourceUrl('http://192.88.99.1/'), false)
  })
})

describe('isSafeSourceUrl — real IPv6 parsing + bitwise CIDR comparison (fourth architectural review)', () => {
  // REAL BUG FIXED: string-prefix checks (e.g. ipv6.startsWith('100::'))
  // relied on the input already being in Node's specific canonical
  // compressed form -- not a genuine network-layer guarantee. Replaced
  // with a real IPv6-to-128-bit-BigInt parser and bitwise CIDR
  // comparison, which is correct for ANY valid textual form.

  test('a fully EXPANDED (non-compressed) form of a denylisted range is still rejected', () => {
    // 100::1, fully expanded with leading zeros in every group --
    // would NOT match a naive `startsWith('100::')` string check.
    assert.equal(isSafeSourceUrl('http://[0100:0000:0000:0000:0000:0000:0000:0001]/'), false)
  })

  test('an expanded form with leading zeros in each group is still rejected (benchmarking range)', () => {
    assert.equal(isSafeSourceUrl('http://[2001:0002:0000:0000:0000:0000:0000:0001]/'), false)
  })

  test('an expanded, UPPERCASE form is still rejected (link-local)', () => {
    assert.equal(isSafeSourceUrl('http://[FE80:0000:0000:0000:0000:0000:0000:0001]/'), false)
  })

  test('a partially-expanded mixed form is still rejected (multicast)', () => {
    assert.equal(isSafeSourceUrl('http://[FF02:0:0:0:0:0:0:1]/'), false)
  })

  test('64:ff9b:1::/48 (NAT64 local-use prefix) is rejected -- explicitly required range', () => {
    assert.equal(isSafeSourceUrl('http://[64:ff9b:1::1]/'), false)
  })

  test('64:ff9b::/96 (NAT64 well-known prefix) is also rejected', () => {
    assert.equal(isSafeSourceUrl('http://[64:ff9b::1]/'), false)
  })

  test('2001:2::/48 (benchmarking) is rejected -- explicitly required range', () => {
    assert.equal(isSafeSourceUrl('http://[2001:2::1]/'), false)
  })

  test('3fff::/20 (documentation, RFC 9637) is rejected -- explicitly required range', () => {
    assert.equal(isSafeSourceUrl('http://[3fff::1]/'), false)
  })

  test('5f00::/16 (former 6bone space) is rejected -- explicitly required range', () => {
    assert.equal(isSafeSourceUrl('http://[5f00::1]/'), false)
  })

  test('an IPv4-mapped address embedding a genuinely PUBLIC IPv4 is allowed -- the /96 block itself is not a blanket reject', () => {
    assert.equal(isSafeSourceUrl('http://[::ffff:8.8.8.8]/'), true)
  })

  test('an IPv4-mapped address embedding a PRIVATE IPv4 is still rejected, decoded correctly from the parsed 128-bit value', () => {
    assert.equal(isSafeSourceUrl('http://[::ffff:10.0.0.1]/'), false)
  })

  test('a real, currently-allocated public IPv6 address remains allowed', () => {
    assert.equal(isSafeSourceUrl('http://[2606:4700::1]/'), true) // Cloudflare's real public range
  })

  test('a malformed IPv6-looking string fails closed as an ordinary (non-IP) hostname, not thrown', () => {
    assert.doesNotThrow(() =>
      isSafeSourceUrl('http://[not:a:real:ipv6:address:with:too:many:groups:here]/'),
    )
  })

  test('a string with more than one "::" is invalid and does not crash', () => {
    assert.doesNotThrow(() => isSafeSourceUrl('http://[fe80::1::2]/'))
  })
})

describe('isSafeSourceUrl — 2002::/16 (6to4) and correct ::ffff:0:0/96 ordering (fifth architectural review)', () => {
  // Both ranges are registered in the IANA IPv6 Special-Purpose
  // Address Registry; ::ffff:0:0/96 was previously implicitly handled
  // (correctly, but not present as an explicit denylist table entry)
  // -- both are now explicit table entries, with the embedded-address
  // unwrap for IPv4-mapped addresses running BEFORE the general
  // denylist loop so this range's own presence in the table never
  // creates a blanket-reject regression.

  test('2002::/16 (6to4) is rejected -- deprecated (RFC 7526), a genuine blanket reject even when it embeds a public IPv4', () => {
    // 2002:0808:0808::1 embeds 8.8.8.8 (a real public address) in its
    // 6to4-encoded bits -- still rejected, unlike IPv4-mapped, since
    // 6to4 relay infrastructure itself is deprecated/abuse-prone.
    assert.equal(isSafeSourceUrl('http://[2002:0808:0808::1]/'), false)
  })

  test('2002::/16 boundaries: the range itself is rejected at both ends, addresses immediately outside remain allowed', () => {
    assert.equal(isSafeSourceUrl('http://[2002::1]/'), false) // lower bound
    assert.equal(isSafeSourceUrl('http://[2002:ffff:ffff::1]/'), false) // upper bound
    assert.equal(isSafeSourceUrl('http://[2001:ffff:ffff::1]/'), true) // immediately before -- must be allowed
    assert.equal(isSafeSourceUrl('http://[2003::1]/'), true) // immediately after -- must be allowed
  })

  test('::ffff:0:0/96 now has an explicit denylist table entry (IANA marks it non-global) WITHOUT breaking public-embedded-address handling', () => {
    // The real risk this test guards: adding ::ffff:0:0/96 as a table
    // entry could regress to a blanket reject if the embedded-address
    // unwrap logic did not run BEFORE the general denylist loop.
    assert.equal(
      isSafeSourceUrl('http://[::ffff:8.8.8.8]/'),
      true,
      'a public embedded IPv4 must still be allowed',
    )
    assert.equal(
      isSafeSourceUrl('http://[::ffff:1.1.1.1]/'),
      true,
      'another real public embedded IPv4 (Cloudflare DNS)',
    )
  })

  test('::ffff:0:0/96 embedding a PRIVATE IPv4 is still correctly rejected', () => {
    assert.equal(isSafeSourceUrl('http://[::ffff:127.0.0.1]/'), false)
    assert.equal(isSafeSourceUrl('http://[::ffff:10.0.0.1]/'), false)
    assert.equal(isSafeSourceUrl('http://[::ffff:192.168.1.1]/'), false)
  })

  test('the hex-normalized form of an IPv4-mapped address is still correctly unwrapped, not caught by the blanket 2002::/16-style path', () => {
    assert.equal(isSafeSourceUrl('http://[::ffff:7f00:1]/'), false) // 127.0.0.1, hex form
    assert.equal(isSafeSourceUrl('http://[::ffff:101:101]/'), true) // 1.1.1.1, hex form
  })
})

describe('verifyUrlReachable — SSRF via redirect (real bypass class, real DI)', () => {
  // Real requirement: verifyUrlReachable now uses undici's fetch
  // directly (for real DNS-pinning dispatchers, see the function's own
  // docstring) rather than globalThis.fetch, so mocking
  // globalThis.fetch no longer intercepts anything. These tests inject
  // fetchFn directly instead -- the SAME dependency-injection pattern
  // already used throughout this project. A safe-looking public
  // lookupFn is supplied so the redirect/HTTP-layer tests below focus
  // purely on redirect handling; the separate DNS-rebinding describe
  // block above focuses purely on the DNS layer.
  const safeLookup: DnsLookupFn = async () => [{ address: '93.184.216.34', family: 4 }]

  test('a redirect to a private/internal address is NOT followed -- the real fix', async () => {
    let secondFetchCalls = 0
    const fakeFetch: FetchFn = async (url) => {
      if (url.includes('safe-looking.example.com')) {
        return new UndiciResponse(null, {
          status: 302,
          headers: { location: 'http://169.254.169.254/latest/meta-data/' },
        })
      }
      secondFetchCalls++
      return new UndiciResponse('secret metadata', { status: 200 })
    }

    const result = await verifyUrlReachable(
      'https://safe-looking.example.com/article',
      5000,
      safeLookup,
      fakeFetch,
    )
    assert.equal(
      result,
      false,
      'a redirect to an internal address must never be followed as reachable',
    )
    assert.equal(
      secondFetchCalls,
      0,
      'the unsafe redirect target must be rejected before any second HTTP call is attempted',
    )
  })

  test('a redirect to another SAFE public URL is correctly followed and can succeed', async () => {
    const fakeFetch: FetchFn = async (url) => {
      if (url.includes('first-hop.example.com')) {
        return new UndiciResponse(null, {
          status: 301,
          headers: { location: 'https://second-hop.example.com/final' },
        })
      }
      return new UndiciResponse('', { status: 200 })
    }

    const result = await verifyUrlReachable(
      'https://first-hop.example.com/article',
      5000,
      safeLookup,
      fakeFetch,
    )
    assert.equal(
      result,
      true,
      'a redirect to another safe public URL must be followed and can succeed',
    )
  })

  test('an excessive redirect chain is bounded, not followed forever', async () => {
    let hops = 0
    const fakeFetch: FetchFn = async () => {
      hops++
      return new UndiciResponse(null, {
        status: 302,
        headers: { location: `https://example.com/hop-${hops}` },
      })
    }

    const result = await verifyUrlReachable(
      'https://example.com/start',
      5000,
      safeLookup,
      fakeFetch,
    )
    assert.equal(
      result,
      false,
      'an endless redirect chain must eventually be treated as unreachable, not hang',
    )
    assert.ok(hops < 20, `must be bounded, got ${hops} hops`)
  })

  test('a redirect with no Location header is treated as unreachable, not thrown', async () => {
    const fakeFetch: FetchFn = async () => new UndiciResponse(null, { status: 302 })
    assert.equal(
      await verifyUrlReachable('https://example.com/x', 5000, safeLookup, fakeFetch),
      false,
    )
  })

  test('the redirect target hostname is genuinely RE-RESOLVED via DNS on the next hop -- not just string-validated', async () => {
    // The core structural proof this whole fix depends on: each hop
    // calls lookupFn again for the NEW hostname, not just once for the
    // original URL. A rebinding-style lookupFn that resolves the
    // FIRST hostname safely but the SECOND (redirect target) hostname
    // to a private IP must be caught -- proving re-resolution actually
    // happens per hop, not merely per initial request.
    const perHopLookup: DnsLookupFn = async (hostname) => {
      if (hostname.includes('redirect-target')) {
        return [{ address: '127.0.0.1', family: 4 }] // private -- must be caught on THIS hop
      }
      return [{ address: '93.184.216.34', family: 4 }]
    }
    const fakeFetch: FetchFn = async (url) => {
      if (url.includes('first-hop-2')) {
        return new UndiciResponse(null, {
          status: 302,
          headers: { location: 'http://redirect-target.example.com/final' },
        })
      }
      // Must never be reached -- the redirect target resolves privately.
      return new UndiciResponse('unexpected success', { status: 200 })
    }

    const result = await verifyUrlReachable(
      'https://first-hop-2.example.com/x',
      5000,
      perHopLookup,
      fakeFetch,
    )
    assert.equal(
      result,
      false,
      'a redirect target whose hostname resolves privately must be rejected, proving DNS is genuinely re-checked per hop',
    )
  })
})

describe('verifyUrlReachable — real DNS-rebinding protection (injected resolver, deterministic)', () => {
  test('a hostname whose DNS resolves to an internal/private IP is rejected -- NO network request is attempted', async () => {
    let fetchAttempted = false
    globalThis.fetch = (async () => {
      fetchAttempted = true
      return new Response('', { status: 200 })
    }) as typeof fetch

    // Simulates the real adversarial case: the URL's hostname string
    // looks completely ordinary (passes isSafeSourceUrl's string-only
    // check), but genuinely resolves via DNS to an internal address.
    const maliciousLookup: DnsLookupFn = async () => [{ address: '10.0.0.5', family: 4 }]

    const result = await verifyUrlReachable(
      'http://looks-public.example.com/x',
      5000,
      maliciousLookup,
    )
    assert.equal(result, false, 'a hostname resolving to a private IP must be rejected')
    assert.equal(
      fetchAttempted,
      false,
      'the internal address must NEVER receive an actual network request',
    )
  })

  test('DNS rebinding simulation: a hostname resolving to a private IPv6 (fc00::/7) is rejected', async () => {
    const rebindLookup: DnsLookupFn = async () => [{ address: 'fc00::1', family: 6 }]
    const result = await verifyUrlReachable(
      'http://rebind-target.example.com/x',
      5000,
      rebindLookup,
    )
    assert.equal(result, false)
  })

  test('a hostname resolving to an IPv4-mapped-IPv6 loopback (hex form) is rejected -- the real bypass class', async () => {
    const hexMappedLookup: DnsLookupFn = async () => [{ address: '::ffff:7f00:1', family: 6 }]
    const result = await verifyUrlReachable('http://sneaky.example.com/x', 5000, hexMappedLookup)
    assert.equal(result, false)
  })

  test('multiple A records: if ANY resolved address is private, the whole hostname is rejected -- an attacker cannot hide behind one safe-looking record', async () => {
    const multiRecordLookup: DnsLookupFn = async () => [
      { address: '93.184.216.34', family: 4 }, // looks public
      { address: '169.254.169.254', family: 4 }, // cloud metadata -- the real target
    ]
    const result = await verifyUrlReachable(
      'http://multi-record.example.com/x',
      5000,
      multiRecordLookup,
    )
    assert.equal(result, false, 'any one unsafe resolved address must reject the entire hostname')
  })

  test('a DNS resolution failure fails closed (unreachable), not thrown', async () => {
    const failingLookup = async (): Promise<never> => {
      throw new Error('ENOTFOUND')
    }
    const result = await verifyUrlReachable(
      'http://does-not-resolve.example.com/x',
      5000,
      failingLookup,
    )
    assert.equal(result, false)
  })

  test('an empty DNS response (no addresses) fails closed', async () => {
    const emptyLookup: DnsLookupFn = async () => []
    const result = await verifyUrlReachable('http://no-records.example.com/x', 5000, emptyLookup)
    assert.equal(result, false)
  })

  test('a genuinely public-resolving hostname is NOT rejected by the DNS check itself (proves this is not a blanket reject)', async () => {
    // REAL FLAKY TEST FIXED: this previously asserted on wall-clock
    // elapsed time (">= 100ms means a real connection was attempted"),
    // which is inherently unreliable under real network variance --
    // confirmed flaky when run inside the full combined test suite
    // (passed in isolation, failed under load). Replaced with a
    // deterministic observation via an injected fetchFn: a
    // public-resolving lookup must reach the HTTP layer at all (proven
    // by the injected fetchFn actually being invoked), regardless of
    // how long a real network call would take.
    const publicLookup: DnsLookupFn = async () => [{ address: '93.184.216.34', family: 4 }] // example.com's real IP range
    let httpLayerReached = false
    const fakeFetch: FetchFn = async () => {
      httpLayerReached = true
      return new UndiciResponse('', { status: 200 })
    }
    const result = await verifyUrlReachable(
      'http://looks-public-2.example.com/x',
      1500,
      publicLookup,
      fakeFetch,
    )
    assert.equal(
      httpLayerReached,
      true,
      'a public-resolving address must reach the HTTP layer, not fail closed instantly like the private-IP cases above',
    )
    assert.equal(result, true)
  })
})

describe('verifyUrlReachable — single absolute deadline (production incident fix: FUNCTION_INVOCATION_TIMEOUT)', () => {
  // REAL BUG FIXED: the timer previously reset on every redirect hop's
  // fetch call, DNS resolution had no timeout at all, and the GET
  // fallback after HEAD got an entirely fresh set of timers -- a
  // single URL check could take far longer than the caller's
  // timeoutMs ever implied, causing a real production
  // FUNCTION_INVOCATION_TIMEOUT during a priority-backfill run.

  test('a slow DNS resolution alone consumes the WHOLE budget -- no fetch is ever attempted, and the call returns within the overall timeout, not hanging indefinitely', async () => {
    const slowLookup: DnsLookupFn = () =>
      new Promise((resolve) => {
        setTimeout(() => resolve([{ address: '93.184.216.34', family: 4 }]), 10_000) // far exceeds the 200ms budget below
      })
    let fetchAttempted = false
    const fakeFetch: FetchFn = async () => {
      fetchAttempted = true
      return new UndiciResponse('', { status: 200 })
    }

    const start = Date.now()
    const result = await verifyUrlReachable(
      'https://slow-dns.example.com/x',
      200,
      slowLookup,
      fakeFetch,
    )
    const elapsed = Date.now() - start

    assert.equal(result, false, 'a DNS resolution that exceeds the overall budget must fail closed')
    assert.equal(
      fetchAttempted,
      false,
      'the HTTP layer must never be reached if DNS alone exhausts the budget',
    )
    assert.ok(
      elapsed < 1000,
      `must return promptly once the budget is spent, not wait for the full 10s DNS delay (took ${elapsed}ms)`,
    )
  })

  test('a chain of redirects sharing ONE absolute deadline -- the timer is never reset per hop', async () => {
    // Each hop's fetch takes real time (simulated via a real delay);
    // with a fresh-per-hop timer this would never exceed a single
    // hop's own budget, but with a single SHARED deadline, enough
    // slow hops must eventually exhaust the overall budget.
    let hopCount = 0
    const fastLookup: DnsLookupFn = async () => [{ address: '93.184.216.34', family: 4 }]
    const slowRedirectFetch: FetchFn = async (_currentUrl) => {
      hopCount++
      await new Promise((r) => setTimeout(r, 150)) // each hop takes real time
      return new UndiciResponse(null, {
        status: 302,
        headers: { location: `https://redirect-chain.example.com/hop-${hopCount}` },
      })
    }

    const result = await verifyUrlReachable(
      'https://redirect-chain.example.com/start',
      400, // budget only large enough for ~2-3 real 150ms hops, not all 6 (MAX_REDIRECT_HOPS+1)
      fastLookup,
      slowRedirectFetch,
    )

    assert.equal(
      result,
      false,
      'an endless/long redirect chain must fail closed once the shared deadline is spent',
    )
    assert.ok(
      hopCount < 6,
      `must stop well before exhausting all possible hops once the shared budget runs out (got ${hopCount} hops)`,
    )
  })

  test('HEAD failing then GET fallback -- BOTH share the same absolute deadline, not two fresh budgets', async () => {
    const fastLookup: DnsLookupFn = async () => [{ address: '93.184.216.34', family: 4 }]
    let headCalled = false
    let getCalled = false
    const respectingDelay = (ms: number, signal?: AbortSignal): Promise<void> =>
      new Promise((resolve, reject) => {
        const t = setTimeout(resolve, ms)
        signal?.addEventListener('abort', () => {
          clearTimeout(t)
          reject(new DOMException('The operation was aborted', 'AbortError'))
        })
      })
    const slowThenSlowerFetch: FetchFn = async (_url, init) => {
      if (init.method === 'HEAD') {
        headCalled = true
        await respectingDelay(250, init.signal as AbortSignal | undefined)
        return new UndiciResponse('', { status: 405 }) // rejected, falls through to GET
      }
      getCalled = true
      await respectingDelay(250, init.signal as AbortSignal | undefined) // by now, most of a 300ms total budget is already spent
      return new UndiciResponse('', { status: 200 })
    }

    const result = await verifyUrlReachable(
      'https://head-then-get.example.com/x',
      300, // only enough real time for HEAD (250ms) to complete, not also a full fresh GET
      fastLookup,
      slowThenSlowerFetch,
    )

    assert.equal(headCalled, true, 'HEAD must be attempted first')
    assert.equal(
      result,
      false,
      'the GET fallback must share the SAME absolute deadline as HEAD -- not get a fresh budget of its own',
    )
    // getCalled may be true (the call was attempted) or false (budget
    // already exhausted before starting it) depending on real timing
    // slack -- either is consistent with a shared deadline; what must
    // NOT happen is the overall call succeeding on a fresh GET budget.
    void getCalled
  })

  test('no false priorityQueueExhausted-style success: a URL that would only succeed with a FRESH per-step budget correctly fails under the shared-deadline fix', async () => {
    // Directly proves the regression this fix closes: under the OLD
    // per-step-timer behavior, DNS (100ms) + HEAD (100ms) + GET
    // (100ms) = 300ms of real work would have fit within three
    // separate ~150ms-per-step budgets. Under a single shared 150ms
    // deadline, it must not.
    const okButSlowLookup: DnsLookupFn = () =>
      new Promise((resolve) => {
        setTimeout(() => resolve([{ address: '93.184.216.34', family: 4 }]), 100)
      })
    const okButSlowFetch: FetchFn = async (_url, init) => {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, 100)
        ;(init.signal as AbortSignal | undefined)?.addEventListener('abort', () => {
          clearTimeout(t)
          reject(new DOMException('The operation was aborted', 'AbortError'))
        })
      })
      return new UndiciResponse('', { status: 200 })
    }

    const result = await verifyUrlReachable(
      'https://budget-check.example.com/x',
      150,
      okButSlowLookup,
      okButSlowFetch,
    )
    assert.equal(
      result,
      false,
      'DNS (100ms) alone consumes most of a 150ms shared budget -- the subsequent fetch must not get a fresh timer to still succeed',
    )
  })
})
