/**
 * AIscentra — Source Collector
 *
 * Fetches and processes a single source. Called per-source to stay within
 * Vercel 10-second function timeout (Readiness Assessment Blocker B-04).
 *
 * Flow: fetch feed → parse → pre-qualify → save observations
 */
import { createAdminClient } from '@/lib/supabase/server'
import { parseFeed } from '@/lib/utils/xml'
import { preQualify } from './pre-qualification'
import type { Source } from '@/types/database'

export interface CollectionResult {
  sourceId: string
  sourceName: string
  fetched: number
  passed: number
  saved: number
  rejected: number
  error?: string
}

// ── Feed URL Resolution ───────────────────────────────────────────────────────
// Some sources need their RSS URL resolved from the base URL

const FEED_URL_MAP: Record<string, string> = {
  'https://openai.com/blog':                    'https://openai.com/blog/rss.xml',
  'https://www.anthropic.com/news':             'https://www.anthropic.com/rss.xml',
  'https://deepmind.google/discover/blog/':     'https://deepmind.google/blog/rss.xml',
  'https://ai.meta.com/blog/':                  'https://ai.meta.com/blog/feed/',
  'https://mistral.ai/news/':                   'https://mistral.ai/feed',
  'https://huggingface.co/blog':                'https://huggingface.co/blog/feed.xml',
  'https://github.blog':                        'https://github.blog/feed/',
  'https://arxiv.org/list/cs.AI/recent':        'https://arxiv.org/rss/cs.AI',
  'https://arxiv.org/list/cs.LG/recent':        'https://arxiv.org/rss/cs.LG',
}

function getFeedUrl(sourceUrl: string): string {
  return FEED_URL_MAP[sourceUrl] ?? sourceUrl
}

// ── Recent URL Cache ──────────────────────────────────────────────────────────
// Fetch recently collected URLs to power PQ-06 duplicate check

async function getRecentUrls(supabase: ReturnType<typeof createAdminClient>): Promise<Set<string>> {
  const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString() // 14 days

  const { data } = await supabase
    .from('observations')
    .select('url')
    .gte('collected_at', cutoff)

  return new Set((data ?? []).map((r: { url: string }) => r.url))
}

// ── Main Collector Function ───────────────────────────────────────────────────

export async function collectSource(source: Source): Promise<CollectionResult> {
  const result: CollectionResult = {
    sourceId:   source.id,
    sourceName: source.name,
    fetched:    0,
    passed:     0,
    saved:      0,
    rejected:   0,
  }

  const supabase = createAdminClient()

  try {
    // 1. Fetch the RSS/Atom feed
    const feedUrl = getFeedUrl(source.url)
    const response = await fetch(feedUrl, {
      headers: {
        'User-Agent': 'AIscentra Observatory/1.0 (https://aiscentra.com)',
        'Accept':     'application/rss+xml, application/atom+xml, application/xml, text/xml',
      },
      signal: AbortSignal.timeout(8000), // 8s timeout — stay within Vercel 10s limit
    })

    if (!response.ok) {
      result.error = `HTTP ${response.status} from ${feedUrl}`
      await updateSourceStatus(supabase, source.id, 'ERROR')
      return result
    }

    const xml = await response.text()

    // 2. Parse feed
    const { items, error: parseError } = parseFeed(xml)
    if (parseError) {
      result.error = `Parse error: ${parseError}`
      await updateSourceStatus(supabase, source.id, 'ERROR')
      return result
    }

    result.fetched = items.length

    if (items.length === 0) {
      await updateSourceStatus(supabase, source.id, 'ACTIVE')
      return result
    }

    // 3. Load recent URLs for deduplication (PQ-06)
    const recentUrls = await getRecentUrls(supabase)

    // 4. Pre-qualify each item
    const qualifiedItems = []
    for (const item of items) {
      const pq = preQualify(item, source, recentUrls)
      if (pq.passed) {
        qualifiedItems.push(item)
        // Add to set to prevent duplicates within same batch
        recentUrls.add(item.url)
      } else {
        result.rejected++
      }
    }

    result.passed = qualifiedItems.length

    if (qualifiedItems.length === 0) {
      await updateSourceStatus(supabase, source.id, 'ACTIVE')
      return result
    }

    // 5. Save observations — upsert to handle race conditions
    const observations = qualifiedItems.map((item) => ({
      source_id:    source.id,
      title:        item.title.slice(0, 500),      // Safety truncation
      content:      item.content.slice(0, 3000),   // Blocker B-01: 3000 char limit
      url:          item.url,
      published_at: item.publishedAt.toISOString(),
      collected_at: new Date().toISOString(),
      processed:    false,
      metadata: {
        feed_url:    getFeedUrl(source.url),
        source_name: source.name,
        source_type: source.type,
      },
    }))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: saved, error: insertError } = await (supabase as any)
      .from('observations')
      .upsert(observations, {
        onConflict:       'url',
        ignoreDuplicates: true,
      })
      .select('id')

    if (insertError) {
      result.error = `Insert error: ${insertError.message}`
      await updateSourceStatus(supabase, source.id, 'ERROR')
      return result
    }

    result.saved = (saved ?? []).length

    // 6. Update source status and last_checked_at
    await updateSourceStatus(supabase, source.id, 'ACTIVE')

    return result

  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    result.error = message
    await updateSourceStatus(supabase, source.id, 'ERROR').catch(() => {})
    return result
  }
}

// ── Source Status Update ──────────────────────────────────────────────────────

async function updateSourceStatus(
  supabase: ReturnType<typeof createAdminClient>,
  sourceId: string,
  status: 'ACTIVE' | 'ERROR',
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any)
    .from('sources')
    .update({
      status,
      last_checked_at: new Date().toISOString(),
    })
    .eq('id', sourceId)
}
