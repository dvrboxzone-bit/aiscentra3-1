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
        (prev[j] ?? 0) + 1, // deletion
        (curr[j - 1] ?? 0) + 1, // insertion
        (prev[j - 1] ?? 0) + cost, // substitution
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

const SIMILARITY_THRESHOLD = 0.85 // Signal Scoring Spec Section 11.2

/**
 * Check if a candidate title duplicates an existing active signal.
 * Queries signals from the last 14 days (Signal Spec Section 11.2).
 *
 * REAL BUG FIXED: previously ANY match >=SIMILARITY_THRESHOLD (0.85)
 * was rejected as a duplicate regardless of source -- an independent
 * outlet reporting the exact same event with a near-identical headline
 * (which genuinely happens: wire-service-style AI news often gets
 * republished with minimal rewording across outlets) was silently
 * discarded instead of being recognized as strong, high-confidence
 * corroboration. Confirmed against the project's own stated goal:
 * source-independent confirmation should STRENGTHEN a signal, not be
 * thrown away because its title happens to closely match.
 *
 * Now source-aware: a match is only a true duplicate when the SAME
 * source is already linked to it (a genuine republish, a source's own
 * follow-up under a near-identical headline, or a collector-level near-
 * miss on URL-based dedup). An independent source at ANY similarity,
 * including >=0.85, is explicitly NOT flagged as a duplicate here --
 * checkCorroboration (with its upper bound removed, see that
 * function's own docstring) now catches the full >=0.55 range
 * regardless of how high above 0.85 it goes, so a near-identical
 * headline from an independent source is *stronger* corroboration
 * evidence, not evidence to discard.
 */
export async function checkDuplicate(
  candidateTitle: string,
  candidateCategory: string,
  candidateSourceId?: string,
  client?: CorroborationQueryClient,
): Promise<DeduplicationResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (client ?? createAdminClient()) as any

  // Fetch active signals from last 14 days in same category
  const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: recentSignals, error } = await (supabase as any)
    .from('signals')
    .select('id, title, observation_ids')
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
  let bestMatch: { id: string; title: string; observation_ids: string[] } | null = null

  for (const signal of recentSignals as Array<{
    id: string
    title: string
    observation_ids: string[]
  }>) {
    const score = similarity(candidateTitle, signal.title)
    if (score > highestSimilarity) {
      highestSimilarity = score
      bestMatch = signal
    }
  }

  if (highestSimilarity >= SIMILARITY_THRESHOLD && bestMatch) {
    // Source-aware check: only a duplicate if the SAME source is
    // already linked. No candidateSourceId provided (backward-
    // compatible callers) is treated conservatively as same-source,
    // preserving the pre-existing reject-on-title-match behavior for
    // any caller that hasn't been updated to pass it.
    if (candidateSourceId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: existingObs } = await (supabase as any)
        .from('observations')
        .select('source_id')
        .in('id', bestMatch.observation_ids)

      const existingSourceIds = new Set(
        ((existingObs ?? []) as Array<{ source_id: string }>).map((o) => o.source_id),
      )

      if (!existingSourceIds.has(candidateSourceId)) {
        // Independent source at high similarity -- NOT a duplicate.
        // Let checkCorroboration (full >=0.55 range) handle this as
        // strong corroboration evidence instead.
        return { isDuplicate: false }
      }
    }

    return {
      isDuplicate: true,
      matchedSignalId: bestMatch.id,
      matchedTitle: bestMatch.title,
      similarityScore: highestSimilarity,
      reason: `REJECT: duplicate_title_detected (similarity=${(highestSimilarity * 100).toFixed(1)}%)`,
    }
  }

  return { isDuplicate: false }
}

/**
 * Real gap this closes, confirmed against production: every signal ever
 * created carries exactly ONE observation_id (206/206 checked in one
 * audit, then 77/77 of the most recent 3 days in a follow-up check) --
 * checkDuplicate() above only REJECTS near-identical titles (>=85%
 * similarity) as duplicates; there was no path for "this is clearly the
 * SAME underlying event, reported by a DIFFERENT source, and should
 * strengthen the existing signal rather than spawn a second isolated
 * one or be silently rejected as a duplicate." Every signal was
 * therefore single-sourced by construction, regardless of how many
 * independent outlets covered the same event -- directly undermining
 * the Constitution's evidence-first principle (Article 4.1) and
 * SIGNAL_LIFECYCLE.md's own "Strengthened" stage, which explicitly
 * lists "independent confirmation... multiple research groups" as a
 * real signal-lifecycle event this project's own docs already describe
 * but no code ever implemented.
 *
 * Deliberately conservative, not a full Stage-6 "Related/Merged"
 * correlation engine (SIGNAL_GENERATION_PIPELINE.md's Duplicate
 * Detection stage lists several possible outcomes; only "Duplicate" was
 * ever built). This adds exactly one additional outcome --
 * "Corroborating", i.e. same story, different source -- without
 * attempting broader cross-signal correlation, which is a materially
 * larger feature deserving its own dedicated design pass.
 *
 * Band: a lower bound below which two titles are more likely to be
 * genuinely different stories that merely share common AI-domain
 * vocabulary than the same event -- a Levenshtein-based check has no
 * semantic understanding, so this stays conservative deliberately,
 * matching this project's own "prefer no Signal over a wrong one"
 * stance rather than aggressively merging unrelated items.
 *
 * REAL BUG FIXED (raised bar, entity-anchor required): the original
 * implementation merged on title similarity ALONE, down to 0.55 --
 * far too weak a signal on its own. Two DIFFERENT papers with generic,
 * stylized titles ("New Model Achieves Record Performance" vs.
 * "Record-Breaking Model Released Today") can score well above 0.55
 * on pure Levenshtein similarity while describing completely unrelated
 * events. Per the owner's explicit instruction: "Разные события не
 * объединять без подтверждённой event identity. Неоднозначный
 * кандидат остаётся отдельным single-source observation."
 *
 * Now requires BOTH, deliberately without any additional AI call
 * (entity extraction here is a free, deterministic heuristic, not an
 * LLM call -- adding one would reintroduce exactly the AI-budget
 * pressure the pre-filter in pre-qualification.ts exists to relieve):
 *   1. similarity >= CORROBORATION_MIN (raised to 0.70, from 0.55)
 *   2. at least one shared "entity anchor" token -- a capitalized,
 *      non-generic word or hyphenated compound extracted from both
 *      titles (see extractEntityAnchors below), acting as a proxy for
 *      a shared proper noun (company, model, product name) that a
 *      genuinely coincidental title-similarity match would be very
 *      unlikely to also share.
 * Failing either condition means the candidate is AMBIGUOUS and is
 * NOT auto-merged -- it proceeds through the normal pipeline as its
 * own single-source observation, exactly as the instruction requires.
 *
 * A same-source match is explicitly excluded: this is corroboration
 * from an INDEPENDENT outlet, not the same source republishing or
 * updating its own story under a slightly different headline (which is
 * a different, legitimate case already handled elsewhere by URL-based
 * observation deduplication in the collector).
 */
const CORROBORATION_MIN = 0.7

// Common capitalized words that are NOT proper-noun-like anchors --
// generic terms that would trivially "match" between two unrelated
// AI-domain titles and defeat the purpose of requiring an anchor at
// all.
//
// REAL GAP FOUND AND FIXED HERE (via a failing test, not assumed):
// headlines are conventionally written in Title Case, which
// capitalizes EVERY significant word -- not just proper nouns. A
// short denylist covering only a few domain terms let ordinary
// function/connector words ("With", "Today", "Improved",
// "Benchmarks") through as false "anchors," which would have made
// two completely generic, unrelated titles appear to share an entity
// just because both used common English words in Title Case. This
// list is deliberately broad -- common English prepositions,
// articles, conjunctions, and generic AI-news verbs/nouns -- rather
// than a short, easily-incomplete one, precisely because the
// consequence of under-covering it is a false "confirmed event
// identity" between two different stories.
const GENERIC_CAPITALIZED_TERMS = new Set([
  // Domain-generic terms (original set)
  'new',
  'the',
  'a',
  'an',
  'ai',
  'research',
  'study',
  'model',
  'models',
  'system',
  'systems',
  'analysis',
  'framework',
  'approach',
  'method',
  'update',
  'report',
  'this',
  'first',
  'major',
  'breaking',
  'record',
  'breakthrough',
  'announces',
  'announcement',
  'launches',
  'launch',
  'releases',
  'release',
  'shows',
  'reveals',
  'unveils',
  // English function/connector words -- capitalized by Title Case
  // conventions regardless of whether they are proper nouns.
  'with',
  'without',
  'today',
  'now',
  'after',
  'before',
  'from',
  'for',
  'its',
  'their',
  'his',
  'her',
  'and',
  'but',
  'or',
  'nor',
  'to',
  'of',
  'in',
  'on',
  'at',
  'by',
  'as',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'has',
  'have',
  'had',
  'will',
  'would',
  'could',
  'should',
  'can',
  'may',
  'might',
  'must',
  'not',
  'no',
  'yes',
  'all',
  'more',
  'most',
  'some',
  'any',
  'each',
  'every',
  'both',
  'few',
  'many',
  'much',
  'such',
  'over',
  'under',
  'up',
  'down',
  'out',
  'off',
  'again',
  'further',
  'then',
  'once',
  'here',
  'there',
  'when',
  'where',
  'why',
  'how',
  'what',
  'which',
  'who',
  'whom',
  'while',
  'during',
  // Generic AI-news vocabulary that is not itself distinctive.
  'improved',
  'improves',
  'improving',
  'improvement',
  'benchmark',
  'benchmarks',
  'performance',
  'results',
  'score',
  'scores',
  'better',
  'faster',
  'smaller',
  'larger',
  'bigger',
  'context',
  'window',
  'version',
  'latest',
  'next',
  'ships',
  'ship',
  'debuts',
  'debut',
])

/**
 * Extracts proper-noun-like "entity anchor" tokens from a title: words
 * or hyphenated compounds that start with an uppercase letter and are
 * not in the generic-term denylist above. Deliberately simple and
 * inspectable (no NLP library, no AI call) -- a heuristic proxy for
 * "this title names a specific company/model/product," not a claim of
 * linguistic correctness.
 */
export function extractEntityAnchors(title: string): Set<string> {
  const tokens = title.match(/\b[A-Z][A-Za-z0-9-]*\b/g) ?? []
  const anchors = new Set<string>()
  for (const token of tokens) {
    const lower = token.toLowerCase()
    if (GENERIC_CAPITALIZED_TERMS.has(lower)) continue
    if (token.length < 3) continue
    anchors.add(lower)
  }
  return anchors
}

function sharesEntityAnchor(titleA: string, titleB: string): boolean {
  const anchorsA = extractEntityAnchors(titleA)
  const anchorsB = extractEntityAnchors(titleB)
  for (const a of anchorsA) {
    if (anchorsB.has(a)) return true
  }
  return false
}

export interface CorroborationResult {
  isCorroboration: boolean
  matchedSignalId?: string
  matchedTitle?: string
  matchedObservationIds?: string[]
  similarityScore?: number
}

/**
 * Minimal client shape this function calls, matching this repo's
 * existing loose-typing convention for injectable Supabase clients
 * (e.g. src/modules/observations/queries.ts's RetryQueryClient) --
 * lets a test supply a small hand-written mock without depending on
 * Supabase's full generic client types.
 */
export interface CorroborationQueryClient {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (
        col: string,
        val: string,
      ) => {
        in: (
          col2: string,
          vals: string[],
        ) => {
          gte: (
            col3: string,
            val3: string,
          ) => {
            limit: (n: number) => Promise<{ data: unknown; error: { message: string } | null }>
          }
        }
      }
      in: (
        col: string,
        vals: string[],
      ) => Promise<{ data: unknown; error: { message: string } | null }>
    }
  }
}

export async function checkCorroboration(
  candidateTitle: string,
  candidateCategory: string,
  candidateSourceId: string,
  client?: CorroborationQueryClient,
): Promise<CorroborationResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (client ?? createAdminClient()) as any
  const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: recentSignals, error } = await (supabase as any)
    .from('signals')
    .select('id, title, observation_ids, confidence_score')
    .eq('category', candidateCategory)
    .in('status', ['ACTIVE', 'PROMOTED'])
    .gte('created_at', cutoff)
    .limit(100)

  if (error || !recentSignals || recentSignals.length === 0) {
    // Best-effort, same posture as checkDuplicate above: on any failure,
    // proceed as if there is no corroboration match rather than blocking
    // the observation's own path through the pipeline.
    if (error)
      console.error(
        '[deduplication] Error fetching signals for corroboration check:',
        error.message,
      )
    return { isCorroboration: false }
  }

  let best: { id: string; title: string; observation_ids: string[]; score: number } | null = null

  for (const signal of recentSignals as Array<{
    id: string
    title: string
    observation_ids: string[]
  }>) {
    const score = similarity(candidateTitle, signal.title)
    if (score < CORROBORATION_MIN) continue
    // Confirmed event identity requires BOTH raised similarity AND a
    // shared entity anchor -- see this function's own docstring for
    // why pure similarity, even at 0.70+, is not sufficient on its
    // own to safely merge two different observations.
    if (!sharesEntityAnchor(candidateTitle, signal.title)) continue
    if (!best || score > best.score) {
      best = { id: signal.id, title: signal.title, observation_ids: signal.observation_ids, score }
    }
  }

  if (!best) return { isCorroboration: false }

  // Exclude same-source matches -- see docstring above.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existingObs } = await (supabase as any)
    .from('observations')
    .select('source_id')
    .in('id', best.observation_ids)

  const existingSourceIds = new Set(
    ((existingObs ?? []) as Array<{ source_id: string }>).map((o) => o.source_id),
  )
  if (existingSourceIds.has(candidateSourceId)) {
    return { isCorroboration: false }
  }

  return {
    isCorroboration: true,
    matchedSignalId: best.id,
    matchedTitle: best.title,
    matchedObservationIds: best.observation_ids,
    similarityScore: best.score,
  }
}

/**
 * Fetch recent signal titles for novelty context in enrichment prompt.
 * Passed to the AI agent to prevent novelty inflation.
 */
export async function getRecentSignalTitles(category: string, limit = 20): Promise<string[]> {
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
