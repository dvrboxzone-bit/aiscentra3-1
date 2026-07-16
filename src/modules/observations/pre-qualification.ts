/**
 * AIscentra — Pre-Qualification Filter
 *
 * Implements PQ-01 through PQ-08 from Signal Scoring Specification v1.0, Section 03.
 * Binary checks — pass all or reject entirely. No partial qualification.
 *
 * Each check returns a specific rejection reason for audit logging.
 */
import type { Source } from '@/types/database'
import type { FeedItem } from '@/lib/utils/xml'

export interface PQResult {
  passed: boolean
  rejectionReason?: string
}

// ── PQ-05: Press Release Boilerplate Patterns ────────────────────────────────
// Signal Scoring Specification v1.0, Section 03.3
// 3 or more matches → marketing content detected

const MARKETING_PATTERNS = [
  /proud\s+to\s+announce|excited\s+to\s+(share|introduce|announce)/i,
  /thrilled\s+to\s+(introduce|announce|share)/i,
  /leading\s+provider\s+of|industry[-\s]leading|world[-\s]class/i,
  /award[-\s]winning|recognized\s+by/i,
  /synergy|ecosystem.*partnership|partnership.*ecosystem/i,
  /contact\s+us\s+today|learn\s+more\s+at|click\s+here\s+to/i,
]

function isMarketingContent(title: string, content: string): boolean {
  const text = `${title} ${content.slice(0, 200)}`
  const matches = MARKETING_PATTERNS.filter((p) => p.test(text)).length
  return matches >= 3
}

// ── PQ-07: Category Keyword Matching ─────────────────────────────────────────
// At least one category keyword must be present

const CATEGORY_KEYWORDS = [
  // MODELS
  'model', 'llm', 'gpt', 'claude', 'gemini', 'mistral', 'llama',
  'benchmark', 'fine-tune', 'weights', 'checkpoint', 'inference',
  // RESEARCH
  'paper', 'arxiv', 'research', 'study', 'findings', 'experiment',
  'dataset', 'evaluation', 'training', 'neural', 'algorithm',
  // COMPANIES
  'openai', 'anthropic', 'deepmind', 'meta ai', 'google ai', 'microsoft',
  'startup', 'acquisition', 'ceo', 'funding round', 'valuation',
  // INFRASTRUCTURE
  'api', 'cloud', 'deployment', 'infrastructure', 'compute', 'gpu',
  'data center', 'platform', 'service', 'endpoint',
  // OPEN SOURCE
  'open source', 'open-source', 'github', 'hugging face', 'release',
  'repository', 'library', 'framework', 'community',
  // FUNDING
  'series', 'investment', 'venture', 'raise', 'funding', 'billion',
  'million', 'investor', 'round',
  // REGULATION
  'regulation', 'policy', 'legislation', 'law', 'compliance',
  'government', 'eu ai act', 'nist', 'safety',
  // AGENTS
  'agent', 'autonomous', 'agentic', 'multi-agent', 'workflow',
  // HARDWARE
  'chip', 'gpu', 'tpu', 'accelerator', 'nvidia', 'amd', 'intel',
  'semiconductor', 'hardware',
]

function hasAIKeyword(title: string, content: string): boolean {
  const text = `${title} ${content}`.toLowerCase()
  return CATEGORY_KEYWORDS.some((kw) => text.includes(kw))
}

// ── Main Pre-Qualification Check ──────────────────────────────────────────────

export function preQualify(
  item: FeedItem,
  source: Pick<Source, 'trust_score'>,
  existingUrls: Set<string>,
): PQResult {
  // PQ-01: Source trust score
  if (source.trust_score < 0.5) {
    return { passed: false, rejectionReason: 'REJECT: source_trust_below_threshold' }
  }

  // PQ-02: Content length
  if (item.content.length < 100) {
    return { passed: false, rejectionReason: 'REJECT: content_too_short' }
  }

  // PQ-03: Recency — published within 72 hours of collection
  const hoursSincePublished = (Date.now() - item.publishedAt.getTime()) / 3600000
  if (hoursSincePublished > 72) {
    return { passed: false, rejectionReason: 'REJECT: observation_stale' }
  }

  // PQ-04: Language detection (simplified — check for English characters)
  // MVP constraint: English only. Full language detection is Post-MVP.
  const nonLatinRatio = (item.title.match(/[^\u0000-\u024F\s]/g) ?? []).length / item.title.length
  if (nonLatinRatio > 0.3) {
    return { passed: false, rejectionReason: 'REJECT: unsupported_language' }
  }

  // PQ-05: Press release boilerplate
  if (isMarketingContent(item.title, item.content)) {
    return { passed: false, rejectionReason: 'REJECT: marketing_content_detected' }
  }

  // PQ-06: Duplicate URL check (fast — against already-collected URLs)
  if (existingUrls.has(item.url)) {
    return { passed: false, rejectionReason: 'REJECT: already_processed' }
  }

  // PQ-07: Category keyword presence
  if (!hasAIKeyword(item.title, item.content)) {
    return { passed: false, rejectionReason: 'REJECT: no_category_match' }
  }

  // PQ-08: URL must be a valid HTTP(S) URL
  if (!item.url.startsWith('http://') && !item.url.startsWith('https://')) {
    return { passed: false, rejectionReason: 'REJECT: invalid_url' }
  }

  return { passed: true }
}
