/**
 * AIscentra — Lightweight RSS/Atom Feed Parser
 *
 * No external dependencies. Parses RSS 2.0 and Atom 1.0 feeds.
 * Runs in Edge runtime (no Node.js APIs required).
 *
 * Design decision: avoid heavy XML libraries to keep bundle small
 * and Edge-compatible. RSS feeds have predictable structure —
 * regex extraction is sufficient and significantly faster.
 */

export interface FeedItem {
  title: string
  url: string
  content: string   // First 3000 chars — Readiness Assessment Blocker B-01
  publishedAt: Date
}

export interface ParsedFeed {
  items: FeedItem[]
  feedTitle: string
  error?: string
}

// ── Extraction Helpers ────────────────────────────────────────────────────────

function extractTag(xml: string, tag: string): string {
  // Try with namespace prefix first, then without
  const patterns = [
    new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i'),
    new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'),
  ]
  for (const pattern of patterns) {
    const match = pattern.exec(xml)
    if (match?.[1]) return match[1].trim()
  }
  return ''
}

function extractAttr(xml: string, tag: string, attr: string): string {
  const pattern = new RegExp(`<${tag}[^>]*${attr}="([^"]*)"`, 'i')
  return pattern.exec(xml)?.[1]?.trim() ?? ''
}

function cleanText(text: string): string {
  return text
    .replace(/<[^>]+>/g, ' ')     // Strip HTML tags
    .replace(/&amp;/g,  '&')
    .replace(/&lt;/g,   '<')
    .replace(/&gt;/g,   '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g,  "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function truncate(text: string, maxLength = 3000): string {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength)
}

function parseDate(dateStr: string): Date {
  if (!dateStr) return new Date()
  const parsed = new Date(dateStr)
  return isNaN(parsed.getTime()) ? new Date() : parsed
}

// ── RSS 2.0 Parser ────────────────────────────────────────────────────────────

function parseRSS(xml: string): FeedItem[] {
  const feedTitle = cleanText(extractTag(xml, 'title'))

  // Split into items
  const itemPattern = /<item[^>]*>([\s\S]*?)<\/item>/gi
  const items: FeedItem[] = []
  let match: RegExpExecArray | null

  while ((match = itemPattern.exec(xml)) !== null) {
    const item = match[1]
    if (!item) continue

    const title = cleanText(extractTag(item, 'title'))
    if (!title) continue

    // URL: prefer <link> text, fall back to guid if it looks like a URL
    let url = cleanText(extractTag(item, 'link'))
    if (!url.startsWith('http')) {
      const guid = cleanText(extractTag(item, 'guid'))
      if (guid.startsWith('http')) url = guid
    }
    if (!url.startsWith('http')) continue

    // Content: prefer content:encoded, then description
    const rawContent =
      extractTag(item, 'content:encoded') ||
      extractTag(item, 'description') ||
      ''

    const content = truncate(cleanText(rawContent) || title)

    const pubDate =
      extractTag(item, 'pubDate') ||
      extractTag(item, 'dc:date') ||
      extractTag(item, 'published')

    items.push({
      title,
      url,
      content,
      publishedAt: parseDate(pubDate),
    })
  }

  return items
}

// ── Atom 1.0 Parser ───────────────────────────────────────────────────────────

function parseAtom(xml: string): FeedItem[] {
  const entryPattern = /<entry[^>]*>([\s\S]*?)<\/entry>/gi
  const items: FeedItem[] = []
  let match: RegExpExecArray | null

  while ((match = entryPattern.exec(xml)) !== null) {
    const entry = match[1]
    if (!entry) continue

    const title = cleanText(extractTag(entry, 'title'))
    if (!title) continue

    // Atom links: <link rel="alternate" href="..."/>
    const altLinkPattern = /<link[^>]*rel="alternate"[^>]*href="([^"]+)"/i
    let url = altLinkPattern.exec(entry)?.[1] ?? ''
    if (!url) {
      // Try href on any link element
      url = extractAttr(entry, 'link', 'href')
    }
    if (!url.startsWith('http')) continue

    const rawContent =
      extractTag(entry, 'content') ||
      extractTag(entry, 'summary') ||
      ''

    const content = truncate(cleanText(rawContent) || title)
    const published = extractTag(entry, 'published') || extractTag(entry, 'updated') || ''

    items.push({
      title,
      url,
      content,
      publishedAt: parseDate(published),
    })
  }

  return items
}

// ── Main Parse Function ───────────────────────────────────────────────────────

export function parseFeed(xml: string): ParsedFeed {
  try {
    const feedTitle = cleanText(extractTag(xml, 'title')) || 'Unknown Feed'
    const isAtom = xml.includes('<feed') && xml.includes('xmlns="http://www.w3.org/2005/Atom"')
    const items = isAtom ? parseAtom(xml) : parseRSS(xml)

    return { feedTitle, items }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Parse error'
    return { feedTitle: '', items: [], error: message }
  }
}
