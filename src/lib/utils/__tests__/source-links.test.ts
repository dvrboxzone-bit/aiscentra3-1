/**
 * AIscentra — source URL safety tests
 *
 * Real requirement: "небезопасный или недоступный URL исключать; если
 * не осталось ни одной доступной ссылки — сигнал не публиковать."
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { isSafeSourceUrl, buildFaviconUrl, filterSafeSourceLinks } from '../source-links'

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
