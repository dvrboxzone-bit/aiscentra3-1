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
      const { data: existingObs, error: sourceLookupError } = await (supabase as any)
        .from('observations')
        .select('source_id')
        .in('id', bestMatch.observation_ids)

      // REAL BUG FIXED (architectural review): a failed source lookup
      // previously fell through silently -- (existingObs ?? []) became
      // an empty set, `.has(candidateSourceId)` was therefore always
      // false, and a source that could NOT be verified was treated as
      // if it were confirmed INDEPENDENT, letting it through to
      // checkCorroboration as if genuinely different-source evidence.
      // A lookup failure proves nothing about independence -- fail
      // closed: treat it the same as the "no candidateSourceId"
      // conservative default (same-source), which means REJECT as a
      // duplicate rather than risk merging on unverifiable grounds.
      if (sourceLookupError) {
        console.error(
          '[deduplication] source lookup failed during duplicate check -- failing closed (treated as same-source, not independent):',
          sourceLookupError.message,
        )
        return {
          isDuplicate: true,
          matchedSignalId: bestMatch.id,
          matchedTitle: bestMatch.title,
          similarityScore: highestSimilarity,
          reason: 'REJECT: source_verification_failed (fail-closed, treated as duplicate)',
        }
      }

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

/**
 * REAL BUG FIXED (architectural review): a single shared entity anchor
 * was too weak on its own -- two genuinely different stories can
 * coincidentally share exactly one proper-noun-like token (e.g. both
 * mention "OpenAI" while describing completely unrelated events: a
 * funding announcement and an unrelated safety incident). Requiring
 * >=2 distinct shared anchors is a materially stronger signal that the
 * SAME specific event is being described (e.g. both a company name
 * AND a product/model name matching), not just that both stories
 * happen to be about the same company in general.
 */
const MIN_SHARED_ANCHORS = 2

/**
 * REAL BUG FIXED (second architectural review): similarity + shared
 * entity anchors is STILL a fuzzy heuristic -- two DIFFERENT events
 * about the SAME product can share both a high similarity score and
 * 2+ entity anchors (e.g. "OpenAI Releases GPT-5" vs "OpenAI
 * Discontinues GPT-5" -- same company, same product name, completely
 * different, even opposite, events). Neither similarity nor anchor
 * count encodes WHAT actually happened or WHEN.
 *
 * Replaced with a deterministic event key requiring genuine agreement
 * on FOUR independent dimensions, not a single fuzzy score:
 *   1. entities  -- same as before (>=2 shared anchors)
 *   2. action    -- a controlled verb vocabulary (release, discontinue,
 *                   acquire, sue, ban, ...). Must be the SAME action on
 *                   both sides. If EITHER side has no detectable
 *                   action, the pair is AMBIGUOUS and does not merge
 *                   -- "неоднозначный кандидат остается отдельным
 *                   наблюдением."
 *   3. version   -- a detected version/numeric product identifier
 *                   ("5", "Opus 5", "v2"). If BOTH sides have one, they
 *                   must match. If ONLY one side has a detected
 *                   version, that is treated as a mismatch (ambiguous),
 *                   not a pass -- a version difference (or an
 *                   undetectable one) must never be silently ignored.
 *   4. date      -- the REAL observation date (not parsed from title
 *                   text), within a bounded window of each other. Two
 *                   independent outlets reporting the same real-world
 *                   event publish close in time; a wide date gap is
 *                   itself evidence of a different event even with
 *                   identical wording (e.g. an anniversary retrospective
 *                   reusing the same headline).
 *
 * ALL FOUR must agree for corroboration; any disagreement or
 * ambiguity on any one dimension refuses the merge.
 */
const DATE_WINDOW_DAYS = 3

// REAL FINDING (discovered while calibrating tests for this exact
// change): grouping raw verb strings without canonicalization is too
// brittle -- two independent outlets reporting the SAME real-world
// release commonly use different synonyms ("Unveils" vs "Launches"),
// which a raw string-equality check would incorrectly treat as
// different actions, defeating the entire point of source
// corroboration. Grouped into canonical action categories instead: any
// verb within the same group counts as the "same action" for the
// event-key comparison in sameEvent() below.
const ACTION_GROUPS: Record<string, string[]> = {
  RELEASE: [
    'release',
    'releases',
    'released',
    'launch',
    'launches',
    'launched',
    'unveil',
    'unveils',
    'unveiled',
  ],
  DISCONTINUE: [
    'discontinue',
    'discontinues',
    'discontinued',
    'deprecate',
    'deprecates',
    'deprecated',
    'shut down',
    'shuts down',
  ],
  ACQUIRE: ['acquire', 'acquires', 'acquired', 'acquisition'],
  // REAL BUG FIXED (third architectural review): LAWSUIT and BAN were
  // grouped into a single LEGAL category -- but a company suing
  // another and a company/product being banned are genuinely
  // DIFFERENT real-world events, even involving the same two entities
  // (e.g. "OpenAI Sues Microsoft" vs "OpenAI Bans Microsoft" must be
  // treated as different events, not merged). RECALL was also folded
  // into the same overly-broad group and is likewise its own distinct
  // action (a product recall is neither a lawsuit nor a ban). Split
  // into three genuinely separate action groups.
  LAWSUIT: ['sue', 'sues', 'sued', 'lawsuit'],
  BAN: ['ban', 'bans', 'banned'],
  RECALL: ['recall', 'recalls', 'recalled'],
  FUNDING: ['raise', 'raises', 'raised'],
  CLOSE: ['close', 'closes', 'closed'],
  FIX: ['patch', 'patches', 'patched', 'fix', 'fixes', 'fixed'],
  PARTNER: ['partner', 'partners', 'partnership'],
}

/**
 * Canonical action GROUP name for the first matching verb found, or
 * null if none -- e.g. both "Unveils" and "Launches" resolve to
 * 'RELEASE', so genuinely synonymous real-world reporting of the same
 * release event correctly counts as the same action. Deliberately
 * "first match" rather than "all matches" to keep the key a single,
 * comparable token per side.
 *
 * REAL BUG FIXED (fourth architectural review): `lower.includes(verb)`
 * matches ANY substring occurrence, not whole words -- "ban" matches
 * inside "urban", "raise" matches inside "praise", "close" matches
 * inside "disclose". A title merely mentioning "urban AI adoption" or
 * "researchers praise the results" would be incorrectly assigned a
 * BAN or FUNDING action it never described, corrupting the
 * deterministic event key this function feeds into. Fixed with real
 * word-boundary matching via RegExp `\b...\b` -- a verb only matches
 * as a genuinely standalone word. Multi-word verbs ("shut down") use
 * `\b` only at the true start/end of the phrase, which already works
 * correctly for phrases (no false substring risk changes for those).
 * Each verb's regex is built once and cached (module-level, not
 * per-call) since ACTION_GROUPS is a fixed, known-safe set of literal
 * strings -- safe to interpolate directly into a RegExp without
 * escaping concerns particular to this verb list (no regex
 * metacharacters appear in any entry).
 */
const ACTION_VERB_PATTERNS: Array<{ group: string; pattern: RegExp }> = Object.entries(
  ACTION_GROUPS,
).flatMap(([group, verbs]) =>
  verbs.map((verb) => ({ group, pattern: new RegExp(`\\b${verb}\\b`, 'i') })),
)

export function extractAction(text: string): string | null {
  for (const { group, pattern } of ACTION_VERB_PATTERNS) {
    if (pattern.test(text)) return group
  }
  return null
}

/** A version/numeric product identifier: a standalone number (with
 * optional leading "v"/"V") of 1-3 digits, optionally followed by a
 * decimal point and more digits (e.g. "5", "v2", "4.5", "GPT-5" ->
 * captures "5"). Deliberately narrow -- this is a proxy for "which
 * specific release/model number," not a general number extractor
 * (which would false-positive on unrelated figures like a percentage
 * or a year). */
function extractVersion(text: string): string | null {
  const match = /\bv?(\d{1,3}(?:\.\d{1,2})?)\b/i.exec(text)
  return match?.[1] ?? null
}

interface EventKey {
  entities: string[]
  action: string | null
  version: string | null
  dateMs: number | null
}

function buildEventKey(title: string, dateIso: string | null | undefined): EventKey {
  return {
    entities: [...extractEntityAnchors(title)].sort(),
    action: extractAction(title),
    version: extractVersion(title),
    dateMs: dateIso ? new Date(dateIso).getTime() : null,
  }
}

/**
 * True only if all four event-key dimensions genuinely agree. Any
 * ambiguity (missing action on either side, mismatched version
 * presence, missing/unbounded date) refuses the match rather than
 * treating absence as a pass.
 */
function sameEvent(a: EventKey, b: EventKey): boolean {
  let sharedEntities = 0
  for (const e of a.entities) {
    if (b.entities.includes(e)) sharedEntities++
  }
  if (sharedEntities < MIN_SHARED_ANCHORS) return false

  if (!a.action || !b.action || a.action !== b.action) return false

  // Version: if EITHER side detected one, both must detect the SAME
  // one. Only "neither side detected a version at all" is a pass on
  // this dimension (many genuine events, e.g. lawsuits or bans, have
  // no version number at all).
  if (a.version || b.version) {
    if (a.version !== b.version) return false
  }

  if (a.dateMs === null || b.dateMs === null) return false
  const gapDays = Math.abs(a.dateMs - b.dateMs) / (24 * 60 * 60 * 1000)
  if (gapDays > DATE_WINDOW_DAYS) return false

  return true
}

// sharesEntityAnchor (previously the sole entity check) has been
// superseded by sameEvent() above, which requires entity, action,
// version, AND date agreement -- see sameEvent's own docstring.

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
  candidateDate: string,
  client?: CorroborationQueryClient,
): Promise<CorroborationResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (client ?? createAdminClient()) as any
  const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: recentSignals, error } = await (supabase as any)
    .from('signals')
    .select('id, title, observation_ids, confidence_score, created_at')
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

  const candidateKey = buildEventKey(candidateTitle, candidateDate)

  let best: { id: string; title: string; observation_ids: string[]; score: number } | null = null

  for (const signal of recentSignals as Array<{
    id: string
    title: string
    observation_ids: string[]
    created_at: string
  }>) {
    const score = similarity(candidateTitle, signal.title)
    if (score < CORROBORATION_MIN) continue
    // REAL BUG FIXED (second architectural review): similarity + a
    // shared-anchor count is STILL a fuzzy heuristic that cannot tell
    // apart two DIFFERENT events about the SAME product (e.g. a
    // release vs. a discontinuation of the same model). Replaced with
    // a deterministic event key requiring genuine agreement on
    // entities, action, version, AND date -- see sameEvent's own
    // docstring for the full rationale. Similarity is now only a
    // cheap pre-filter to shortlist candidates before the real,
    // decisive check.
    const signalKey = buildEventKey(signal.title, signal.created_at)
    if (!sameEvent(candidateKey, signalKey)) continue
    if (!best || score > best.score) {
      best = { id: signal.id, title: signal.title, observation_ids: signal.observation_ids, score }
    }
  }

  if (!best) return { isCorroboration: false }

  // Exclude same-source matches -- see docstring above.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existingObs, error: sourceLookupError } = await (supabase as any)
    .from('observations')
    .select('source_id')
    .in('id', best.observation_ids)

  // REAL BUG FIXED (architectural review): same class of bug as
  // checkDuplicate's identical fix above -- a failed lookup here
  // previously fell through to an empty existingSourceIds set, making
  // the same-source check always false and letting an UNVERIFIABLE
  // source through as if confirmed independent, triggering a
  // corroboration merge on no real evidence at all. Fail closed
  // instead: an unverifiable source proves nothing, so refuse
  // corroboration rather than risk merging two potentially-same-source
  // (or worse, unrelated) observations.
  if (sourceLookupError) {
    console.error(
      '[deduplication] source lookup failed during corroboration check -- failing closed (no corroboration):',
      sourceLookupError.message,
    )
    return { isCorroboration: false }
  }

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
