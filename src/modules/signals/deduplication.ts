/**
 * AIscentra — Signal Deduplication (Layer 1)
 *
 * Implements Layer 1 title similarity check from Signal Scoring Spec v1.0, Section 11.2.
 * Uses normalized Levenshtein distance.
 * Threshold: 85% similarity → potential duplicate → reject before enrichment.
 *
 * Layer 2 (semantic AI check) is Post-MVP (Section 11.3).
 */
import { createAdminClient } from '@/lib/supabase/server'

// ── Levenshtein Distance ──────────────────────────────────────────────────────

function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length

  if (m === 0) return n
  if (n === 0) return m

  // Use two rows to save memory
  let prev = Array.from({ length: n + 1 }, (_, i) => i)
  let curr = new Array<number>(n + 1)

  for (let i = 1; i <= m; i++) {
    curr[0] = i
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(
        (prev[j] ?? 0) + 1,         // deletion
        (curr[j - 1] ?? 0) + 1,     // insertion
        (prev[j - 1] ?? 0) + cost,  // substitution
      )
    }
    ;[prev, curr] = [curr, prev]
  }

  return prev[n] ?? 0
}

/**
 * Normalize title for comparison.
 * Signal Scoring Spec v1.0, Section 11.2:
 * "normalize() = lowercase, strip punctuation, trim whitespace"
 */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Compute similarity ratio (0–1) between two strings.
 * 1.0 = identical, 0.0 = completely different.
 */
function similarity(a: string, b: string): number {
  const normA = normalizeTitle(a)
  const normB = normalizeTitle(b)

  if (normA === normB) return 1.0
  if (normA.length === 0 || normB.length === 0) return 0.0

  const dist = levenshtein(normA, normB)
  const maxLen = Math.max(normA.length, normB.length)
  return 1 - dist / maxLen
}

// ── Deduplication Check ───────────────────────────────────────────────────────

export interface DeduplicationResult {
  isDuplicate: boolean
  matchedSignalId?: string
  matchedTitle?: string
  similarityScore?: number
  reason?: string
}

const SIMILARITY_THRESHOLD = 0.85  // Signal Scoring Spec Section 11.2

/**
 * Check if a candidate title duplicates an existing active signal.
 * Queries signals from the last 14 days (Signal Spec Section 11.2).
 */
export async function checkDuplicate(
  candidateTitle: string,
  candidateCategory: string,
): Promise<DeduplicationResult> {
  const supabase = createAdminClient()

  // Fetch active signals from last 14 days in same category
  const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: recentSignals, error } = await (supabase as any)
    .from('signals')
    .select('id, title')
    .eq('category', candidateCategory)
    .in('status', ['ACTIVE', 'PROMOTED', 'DRAFT'])
    .gte('created_at', cutoff)
    .limit(100)

  if (error) {
    // On error, allow through — deduplication is best-effort
    console.error('[deduplication] Error fetching recent signals:', error.message)
    return { isDuplicate: false }
  }

  if (!recentSignals || recentSignals.length === 0) {
    return { isDuplicate: false }
  }

  // Compare against all recent signals
  let highestSimilarity = 0
  let bestMatch: { id: string; title: string } | null = null

  for (const signal of recentSignals) {
    const score = similarity(candidateTitle, signal.title as string)
    if (score > highestSimilarity) {
      highestSimilarity = score
      bestMatch = signal as { id: string; title: string }
    }
  }

  if (highestSimilarity >= SIMILARITY_THRESHOLD && bestMatch) {
    return {
      isDuplicate:     true,
      matchedSignalId: bestMatch.id,
      matchedTitle:    bestMatch.title,
      similarityScore: highestSimilarity,
      reason:          `REJECT: duplicate_title_detected (similarity=${(highestSimilarity * 100).toFixed(1)}%)`,
    }
  }

  return { isDuplicate: false }
}

/**
 * Fetch recent signal titles for novelty context in enrichment prompt.
 * Passed to the AI agent to prevent novelty inflation.
 */
export async function getRecentSignalTitles(
  category: string,
  limit = 20,
): Promise<string[]> {
  const supabase = createAdminClient()

  const { data } = await supabase
    .from('signals')
    .select('title')
    .eq('category', category)
    .in('status', ['ACTIVE', 'PROMOTED'])
    .order('created_at', { ascending: false })
    .limit(limit)

  return (data ?? []).map((s: { title: string }) => s.title)
}
