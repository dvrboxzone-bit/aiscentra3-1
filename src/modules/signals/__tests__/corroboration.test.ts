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

import { checkCorroboration, type CorroborationQueryClient } from '../deduplication'

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
  test('a genuinely related title from a DIFFERENT source is flagged as corroboration', async () => {
    const client = makeMockClient({
      signals: [
        {
          id: 'sig-1',
          title: 'OpenAI Releases New Reasoning Model With Improved Benchmarks',
          observation_ids: ['obs-a'],
          confidence_score: 60,
        },
      ],
      existingSourceIds: ['source-openai-blog'], // the EXISTING signal's own source
    })

    const result = await checkCorroboration(
      'OpenAI Ships New Reasoning Model, Benchmark Scores Improve',
      'Models',
      'source-arxiv', // a DIFFERENT source than the existing signal's
      client,
    )

    assert.equal(result.isCorroboration, true)
    assert.equal(result.matchedSignalId, 'sig-1')
    assert.ok(
      result.similarityScore && result.similarityScore >= 0.55 && result.similarityScore < 0.85,
    )
  })

  test('the SAME source is excluded -- this is corroboration from an independent outlet, not a republish', async () => {
    const client = makeMockClient({
      signals: [
        {
          id: 'sig-1',
          title: 'OpenAI Releases New Reasoning Model With Improved Benchmarks',
          observation_ids: ['obs-a'],
          confidence_score: 60,
        },
      ],
      existingSourceIds: ['source-arxiv'], // SAME source as the candidate below
    })

    const result = await checkCorroboration(
      'OpenAI Ships New Reasoning Model, Benchmark Scores Improve',
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
