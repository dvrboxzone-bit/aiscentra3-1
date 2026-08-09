/**
 * AIscentra — source-diversification (corroboration) tests
 *
 * REAL GAP this closes: every signal was single-sourced by construction
 * (206/206 checked in one audit, 77/77 of the most recent 3 days in a
 * follow-up) -- checkDuplicate() only rejected near-identical titles;
 * there was no path for "same event, independent source" to strengthen
 * an existing signal instead of being silently absent from any
 * cross-source verification at all.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  checkCorroboration,
  extractEntityAnchors as extractEntityAnchorsForTest,
  type CorroborationQueryClient,
} from '../deduplication'

function makeMockClient(config: {
  signals?: Array<{
    id: string
    title: string
    observation_ids: string[]
    confidence_score: number
  }>
  existingSourceIds?: string[]
}): CorroborationQueryClient {
  return {
    from: (table: string) => {
      if (table === 'signals') {
        return {
          select: (_cols: string) => ({
            eq: (_col: string, _val: string) => ({
              in: (_col2: string, _vals: string[]) => ({
                gte: (_col3: string, _val3: string) => ({
                  limit: async (_n: number) => ({ data: config.signals ?? [], error: null }),
                }),
              }),
            }),
            in: async () => ({ data: [], error: null }), // unused in this branch
          }),
        }
      }
      // 'observations' table -- source_id lookup
      return {
        select: (_cols: string) => ({
          eq: async () => ({ data: [], error: null }), // unused in this branch
          in: async (_col: string, _vals: string[]) => ({
            data: (config.existingSourceIds ?? []).map((source_id) => ({ source_id })),
            error: null,
          }),
        }),
      }
    },
  } as unknown as CorroborationQueryClient
}

describe('checkCorroboration', () => {
  test('a genuinely related title from a DIFFERENT source, sharing an entity anchor, IS corroboration', async () => {
    const client = makeMockClient({
      signals: [
        {
          id: 'sig-1',
          title: 'Anthropic Unveils Claude Opus 5',
          observation_ids: ['obs-a'],
          confidence_score: 60,
        },
      ],
      existingSourceIds: ['source-anthropic-blog'], // the EXISTING signal's own source
    })

    const result = await checkCorroboration(
      'Anthropic Launches Claude Opus 5',
      'Models',
      'source-arxiv', // a DIFFERENT source than the existing signal's
      client,
    )

    assert.equal(result.isCorroboration, true)
    assert.equal(result.matchedSignalId, 'sig-1')
    // Real similarity (0.813, normalized-title Levenshtein) clears the
    // raised 0.70 bar, AND both titles share the entity anchors
    // "anthropic" and "opus" -- a genuinely confident,
    // confirmed-event-identity match, not fuzzy-string luck alone.
    assert.ok(result.similarityScore && result.similarityScore >= 0.7)
  })

  test('a WEAK title match (~0.55), even from an independent source, is AMBIGUOUS and does NOT auto-merge -- the real fix', async () => {
    const client = makeMockClient({
      signals: [
        {
          id: 'sig-1',
          title: 'OpenAI Releases New Reasoning Model With Improved Benchmarks',
          observation_ids: ['obs-a'],
          confidence_score: 60,
        },
      ],
      existingSourceIds: ['source-openai-blog'],
    })

    const result = await checkCorroboration(
      // Real normalized-title similarity here is ~0.550 -- above the
      // OLD 0.55 threshold (which used to auto-merge this pair), below
      // the NEW 0.70 bar this fix requires.
      'OpenAI Ships New Reasoning Model, Benchmark Scores Improve',
      'Models',
      'source-arxiv',
      client,
    )

    assert.equal(
      result.isCorroboration,
      false,
      'a borderline title match must remain an ambiguous, single-source observation -- it must not be silently merged on weak similarity alone',
    )
  })

  test('generic titles sharing no proper-noun-like entity anchor are never corroboration, regardless of similarity', () => {
    // Every capitalized/keyword token here is in the generic-term
    // denylist (Company is not capitalized-denylisted by name, but
    // Releases/New/Model/Improved/Benchmarks/Today all are) -- proves
    // extractEntityAnchors itself filters correctly, which is what
    // sharesEntityAnchor (and therefore checkCorroboration) depends on.
    const anchors = extractEntityAnchorsForTest('Releases New Model With Improved Benchmarks Today')
    assert.equal(anchors.size, 0, 'an all-generic title must produce zero entity anchors')
  })

  test('the SAME source is excluded -- this is corroboration from an independent outlet, not a republish', async () => {
    const client = makeMockClient({
      signals: [
        {
          id: 'sig-1',
          title: 'Anthropic Unveils Claude Opus 5',
          observation_ids: ['obs-a'],
          confidence_score: 60,
        },
      ],
      existingSourceIds: ['source-arxiv'], // SAME source as the candidate below
    })

    const result = await checkCorroboration(
      // Deliberately a pair that clears BOTH the similarity bar and
      // the entity-anchor requirement (same as the "genuinely related"
      // test above), so a false result here is proven to come from the
      // same-source exclusion specifically -- not from failing an
      // earlier gate for an unrelated reason.
      'Anthropic Launches Claude Opus 5',
      'Models',
      'source-arxiv', // same source as existingSourceIds
      client,
    )

    assert.equal(result.isCorroboration, false, 'same-source match must not count as corroboration')
  })

  test('near-identical titles (>=0.85) from an INDEPENDENT source ARE corroboration -- checkDuplicate already excludes same-source matches before this function is reached', async () => {
    const client = makeMockClient({
      signals: [
        {
          id: 'sig-1',
          title: 'OpenAI Releases New Reasoning Model',
          observation_ids: ['obs-a'],
          confidence_score: 60,
        },
      ],
      existingSourceIds: ['source-openai-blog'],
    })

    const result = await checkCorroboration(
      'OpenAI Releases New Reasoning Model', // identical -- but independent source
      'Models',
      'source-arxiv',
      client,
    )

    assert.equal(
      result.isCorroboration,
      true,
      'no upper similarity bound: a near-identical headline from an independent source is STRONGER corroboration evidence, not weaker -- checkDuplicate is the one responsible for rejecting same-source near-identical matches',
    )
  })

  test('genuinely unrelated titles (below the 0.55 floor) are not corroboration', async () => {
    const client = makeMockClient({
      signals: [
        {
          id: 'sig-1',
          title: 'Quantum Error Correction Breakthrough Announced',
          observation_ids: ['obs-a'],
          confidence_score: 60,
        },
      ],
      existingSourceIds: ['source-nature'],
    })

    const result = await checkCorroboration(
      'New Robotics Startup Raises Series A Funding',
      'Research',
      'source-techcrunch',
      client,
    )

    assert.equal(result.isCorroboration, false)
  })

  test('no recent signals in category -> no corroboration, no crash', async () => {
    const client = makeMockClient({ signals: [] })
    const result = await checkCorroboration('Anything At All', 'Models', 'source-x', client)
    assert.equal(result.isCorroboration, false)
  })

  test('a database error fails open (no corroboration) rather than throwing', async () => {
    const client: CorroborationQueryClient = {
      from: (_table: string) =>
        ({
          select: () => ({
            eq: () => ({
              in: () => ({
                gte: () => ({
                  limit: async () => ({ data: null, error: { message: 'connection reset' } }),
                }),
              }),
            }),
          }),
        }) as unknown as ReturnType<CorroborationQueryClient['from']>,
    }
    const result = await checkCorroboration('Anything', 'Models', 'source-x', client)
    assert.equal(result.isCorroboration, false)
  })
})
