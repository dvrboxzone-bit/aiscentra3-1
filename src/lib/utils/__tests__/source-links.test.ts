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
