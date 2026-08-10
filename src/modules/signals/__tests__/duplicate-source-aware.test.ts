/**
 * AIscentra — source-aware checkDuplicate tests
 *
 * REAL BUG this guards: checkDuplicate() previously rejected ANY match
 * >=0.85 title similarity as a duplicate regardless of source. An
 * independent outlet reporting the exact same event with a near-
 * identical headline was silently discarded instead of being routed to
 * checkCorroboration as strong, high-confidence corroboration evidence.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { checkDuplicate, type CorroborationQueryClient } from '../deduplication'

function makeMockClient(config: {
  signals?: Array<{ id: string; title: string; observation_ids: string[] }>
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
            in: async () => ({ data: [], error: null }),
          }),
        }
      }
      return {
        select: (_cols: string) => ({
          eq: async () => ({ data: [], error: null }),
          in: async (_col: string, _vals: string[]) => ({
            data: (config.existingSourceIds ?? []).map((source_id) => ({ source_id })),
            error: null,
          }),
        }),
      }
    },
  } as unknown as CorroborationQueryClient
}

describe('checkDuplicate — source-aware', () => {
  test('SAME source at >=0.85 similarity IS a duplicate (unchanged behavior)', async () => {
    const client = makeMockClient({
      signals: [
        { id: 'sig-1', title: 'OpenAI Releases New Reasoning Model', observation_ids: ['obs-a'] },
      ],
      existingSourceIds: ['source-openai-blog'],
    })

    const result = await checkDuplicate(
      'OpenAI Releases New Reasoning Model', // identical
      'Models',
      'source-openai-blog', // SAME source as the existing signal
      client,
    )

    assert.equal(result.isDuplicate, true)
    assert.equal(result.matchedSignalId, 'sig-1')
  })

  test('INDEPENDENT source at >=0.85 similarity is NOT a duplicate -- the real fix', async () => {
    const client = makeMockClient({
      signals: [
        { id: 'sig-1', title: 'OpenAI Releases New Reasoning Model', observation_ids: ['obs-a'] },
      ],
      existingSourceIds: ['source-openai-blog'],
    })

    const result = await checkDuplicate(
      'OpenAI Releases New Reasoning Model', // identical
      'Models',
      'source-arxiv', // DIFFERENT source
      client,
    )

    assert.equal(
      result.isDuplicate,
      false,
      'an independent source reporting the same event must not be silently discarded -- it belongs to checkCorroboration instead',
    )
  })

  test('below 0.85 similarity is never a duplicate, regardless of source', async () => {
    const client = makeMockClient({
      signals: [
        { id: 'sig-1', title: 'Quantum Error Correction Breakthrough', observation_ids: ['obs-a'] },
      ],
      existingSourceIds: ['source-nature'],
    })

    const result = await checkDuplicate(
      'New Robotics Startup Raises Series A Funding',
      'Research',
      'source-nature', // even the SAME source, but unrelated title
      client,
    )

    assert.equal(result.isDuplicate, false)
  })

  test('no sourceId provided falls back to the conservative pre-existing behavior (treated as same-source)', async () => {
    const client = makeMockClient({
      signals: [
        { id: 'sig-1', title: 'OpenAI Releases New Reasoning Model', observation_ids: ['obs-a'] },
      ],
      existingSourceIds: ['source-openai-blog'],
    })

    const result = await checkDuplicate(
      'OpenAI Releases New Reasoning Model',
      'Models',
      undefined, // no sourceId -- backward-compatible callers
      client,
    )

    assert.equal(
      result.isDuplicate,
      true,
      'without a sourceId, preserve the original reject-on-match behavior',
    )
  })

  test('a database error on the source lookup FAILS CLOSED (treated as duplicate, not independent) -- the real security fix', async () => {
    const client: CorroborationQueryClient = {
      from: (table: string) => {
        if (table === 'signals') {
          return {
            select: () => ({
              eq: () => ({
                in: () => ({
                  gte: () => ({
                    limit: async () => ({
                      data: [
                        {
                          id: 'sig-1',
                          title: 'OpenAI Releases New Reasoning Model',
                          observation_ids: ['obs-a'],
                        },
                      ],
                      error: null,
                    }),
                  }),
                }),
              }),
              in: async () => ({ data: [], error: null }),
            }),
          }
        }
        return {
          select: () => ({
            eq: async () => ({ data: [], error: null }),
            in: async () => ({ data: null, error: { message: 'connection reset' } }),
          }),
        }
      },
    } as unknown as CorroborationQueryClient

    const result = await checkDuplicate(
      'OpenAI Releases New Reasoning Model',
      'Models',
      'source-arxiv',
      client,
    )
    // REAL BUG FIXED: previously a failed lookup fell through to an
    // empty existingSourceIds set, making candidateSourceId "not
    // found" and therefore treated as CONFIRMED INDEPENDENT --
    // exactly backwards, since a lookup failure proves nothing about
    // independence. Now fails closed: an unverifiable source is
    // treated the same as same-source (the existing conservative
    // default), which means REJECT as a duplicate rather than risk a
    // merge on unverifiable grounds.
    assert.equal(
      result.isDuplicate,
      true,
      'an unverifiable source lookup must fail closed (duplicate), never be silently treated as a confirmed independent source',
    )
  })
})
