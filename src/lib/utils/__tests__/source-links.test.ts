/**
 * AIscentra — source URL safety tests
 *
 * Real requirement: "небезопасный или недоступный URL исключать; если
 * не осталось ни одной доступной ссылки — сигнал не публиковать."
 */
import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'

import {
  isSafeSourceUrl,
  buildFaviconUrl,
  filterSafeSourceLinks,
  verifyUrlReachable,
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

describe('verifyUrlReachable', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test('unsafe URLs are never even attempted -- fails before any fetch call', async () => {
    let fetchCalled = false
    globalThis.fetch = (async () => {
      fetchCalled = true
      return new Response('', { status: 200 })
    }) as typeof fetch

    const result = await verifyUrlReachable('javascript:alert(1)')
    assert.equal(result, false)
    assert.equal(fetchCalled, false, 'an unsafe URL must never reach the network layer at all')
  })

  test('a 200 HEAD response is reachable', async () => {
    globalThis.fetch = (async () => new Response('', { status: 200 })) as typeof fetch
    assert.equal(await verifyUrlReachable('https://example.com/article'), true)
  })

  test('a 404 is NOT reachable, even though the domain itself responded', async () => {
    globalThis.fetch = (async () => new Response('', { status: 404 })) as typeof fetch
    assert.equal(await verifyUrlReachable('https://example.com/gone'), false)
  })

  test('HEAD rejected (405) falls back to a ranged GET, which can still succeed', async () => {
    let calls = 0
    globalThis.fetch = (async (_url, init) => {
      calls++
      const method = (init as RequestInit | undefined)?.method
      if (method === 'HEAD') return new Response('', { status: 405 })
      return new Response('', { status: 200 })
    }) as typeof fetch

    const result = await verifyUrlReachable('https://example.com/no-head-support')
    assert.equal(result, true)
    assert.equal(calls, 2, 'must attempt HEAD first, then fall back to GET')
  })

  test('a network error (fetch throws) is treated as unreachable, never crashes', async () => {
    globalThis.fetch = (async () => {
      throw new Error('DNS resolution failed')
    }) as typeof fetch
    assert.equal(await verifyUrlReachable('https://this-does-not-resolve.invalid/x'), false)
  })

  test('a timeout (AbortError) is treated as unreachable', async () => {
    globalThis.fetch = (async (_url, init) => {
      return new Promise((_resolve, reject) => {
        ;(init as RequestInit | undefined)?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted', 'AbortError'))
        })
      })
    }) as typeof fetch
    assert.equal(await verifyUrlReachable('https://example.com/slow', 50), false)
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

describe('verifyUrlReachable — SSRF via redirect (real bypass class)', () => {
  const originalFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test('a redirect to a private/internal address is NOT followed -- the real fix', async () => {
    let calls = 0
    globalThis.fetch = (async (url: string | URL | Request) => {
      calls++
      const urlStr = typeof url === 'string' ? url : url.toString()
      if (urlStr.includes('safe-looking.example.com')) {
        return new Response(null, {
          status: 302,
          headers: { location: 'http://169.254.169.254/latest/meta-data/' },
        })
      }
      // Should NEVER be reached -- the redirect target is unsafe.
      return new Response('secret metadata', { status: 200 })
    }) as typeof fetch

    const result = await verifyUrlReachable('https://safe-looking.example.com/article')
    assert.equal(
      result,
      false,
      'a redirect to an internal address must never be followed as reachable',
    )
    assert.ok(calls <= 4, 'must not retry indefinitely against the same unsafe redirect')
  })

  test('a redirect to another SAFE public URL is correctly followed and can succeed', async () => {
    globalThis.fetch = (async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url.toString()
      if (urlStr.includes('first-hop.example.com')) {
        return new Response(null, {
          status: 301,
          headers: { location: 'https://second-hop.example.com/final' },
        })
      }
      return new Response('', { status: 200 })
    }) as typeof fetch

    const result = await verifyUrlReachable('https://first-hop.example.com/article')
    assert.equal(
      result,
      true,
      'a redirect to another safe public URL must be followed and can succeed',
    )
  })

  test('an excessive redirect chain is bounded, not followed forever', async () => {
    let hops = 0
    globalThis.fetch = (async () => {
      hops++
      return new Response(null, {
        status: 302,
        headers: { location: `https://example.com/hop-${hops}` },
      })
    }) as typeof fetch

    const result = await verifyUrlReachable('https://example.com/start')
    assert.equal(
      result,
      false,
      'an endless redirect chain must eventually be treated as unreachable, not hang',
    )
    assert.ok(hops < 20, `must be bounded, got ${hops} hops`)
  })

  test('a redirect with no Location header is treated as unreachable, not thrown', async () => {
    globalThis.fetch = (async () => new Response(null, { status: 302 })) as typeof fetch
    assert.equal(await verifyUrlReachable('https://example.com/x'), false)
  })
})
