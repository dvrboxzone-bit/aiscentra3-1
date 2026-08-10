/**
 * AIscentra — source-diversification (corroboration) tests
 *
 * REAL GAP this closes: every signal was single-sourced by construction
 * (206/206 checked in one audit, 77/77 of the most recent 3 days in a
 * follow-up) -- checkDuplicate() only rejected near-identical titles;
 * there was no path for "same event, independent source" to strengthen
 * an existing signal instead of being silently absent from any
 * cross-source verification at all.
 *
 * Second architectural review replaced similarity+anchor-count with a
 * deterministic event key (entities + action + version + date) -- see
 * deduplication.ts's own sameEvent() docstring for the full rationale.
 * All fixtures below now carry real created_at dates (event keys
 * require date agreement) and titles containing a real, matching
 * action verb where corroboration is expected.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  checkCorroboration,
  extractEntityAnchors as extractEntityAnchorsForTest,
  type CorroborationQueryClient,
} from '../deduplication'

const DAY = 24 * 60 * 60 * 1000
const BASE_DATE = '2026-08-08T12:00:00.000Z'

function makeMockClient(config: {
  signals?: Array<{
    id: string
    title: string
    observation_ids: string[]
    confidence_score: number
    created_at?: string
  }>
  existingSourceIds?: string[]
}): CorroborationQueryClient {
  const signalsWithDates = (config.signals ?? []).map((s) => ({
    ...s,
    created_at: s.created_at ?? BASE_DATE,
  }))
  return {
    from: (table: string) => {
      if (table === 'signals') {
        return {
          select: (_cols: string) => ({
            eq: (_col: string, _val: string) => ({
              in: (_col2: string, _vals: string[]) => ({
                gte: (_col3: string, _val3: string) => ({
                  limit: async (_n: number) => ({ data: signalsWithDates, error: null }),
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

describe('checkCorroboration — real event-identity match (entity + action + version + date)', () => {
  test('a genuinely related title from a DIFFERENT source, sharing entities + action + version + date, IS corroboration', async () => {
    const client = makeMockClient({
      signals: [
        {
          id: 'sig-1',
          title: 'Anthropic Unveils Claude Opus 5',
          observation_ids: ['obs-a'],
          confidence_score: 60,
          created_at: BASE_DATE,
        },
      ],
      existingSourceIds: ['source-anthropic-blog'], // the EXISTING signal's own source
    })

    const result = await checkCorroboration(
      'Anthropic Launches Claude Opus 5', // "Unveils"/"Launches" -- same RELEASE action group
      'Models',
      'source-arxiv', // a DIFFERENT source than the existing signal's
      BASE_DATE, // same real-world day
      client,
    )

    assert.equal(result.isCorroboration, true)
    assert.equal(result.matchedSignalId, 'sig-1')
  })

  test('a WEAK title match (~0.55 similarity), even from an independent source, is AMBIGUOUS and does NOT auto-merge', async () => {
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
      'OpenAI Ships New Reasoning Model, Benchmark Scores Improve',
      'Models',
      'source-arxiv',
      BASE_DATE,
      client,
    )

    assert.equal(
      result.isCorroboration,
      false,
      'a borderline title match must remain an ambiguous, single-source observation',
    )
  })

  test('generic titles sharing no proper-noun-like entity anchor are never corroboration, regardless of similarity', () => {
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
          created_at: BASE_DATE,
        },
      ],
      existingSourceIds: ['source-arxiv'], // SAME source as the candidate below
    })

    const result = await checkCorroboration(
      'Anthropic Launches Claude Opus 5',
      'Models',
      'source-arxiv', // same source as existingSourceIds
      BASE_DATE,
      client,
    )

    assert.equal(result.isCorroboration, false, 'same-source match must not count as corroboration')
  })

  test('near-identical titles (>=0.85) from an INDEPENDENT source, same event key, ARE corroboration', async () => {
    const client = makeMockClient({
      signals: [
        {
          id: 'sig-1',
          title: 'OpenAI Releases New Reasoning Model Codex 5',
          observation_ids: ['obs-a'],
          confidence_score: 60,
          created_at: BASE_DATE,
        },
      ],
      existingSourceIds: ['source-openai-blog'],
    })

    const result = await checkCorroboration(
      'OpenAI Releases New Reasoning Model Codex 5', // identical -- but independent source
      'Models',
      'source-arxiv',
      BASE_DATE,
      client,
    )

    assert.equal(result.isCorroboration, true)
  })

  test('genuinely unrelated titles (below the similarity floor) are not corroboration', async () => {
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
      BASE_DATE,
      client,
    )

    assert.equal(result.isCorroboration, false)
  })

  test('no recent signals in category -> no corroboration, no crash', async () => {
    const client = makeMockClient({ signals: [] })
    const result = await checkCorroboration(
      'Anything At All',
      'Models',
      'source-x',
      BASE_DATE,
      client,
    )
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
    const result = await checkCorroboration('Anything', 'Models', 'source-x', BASE_DATE, client)
    assert.equal(result.isCorroboration, false)
  })
})

describe('checkCorroboration — requires >=2 shared entity anchors (real hardening)', () => {
  test('exactly ONE shared anchor is NOT enough -- two different events mentioning the same single company must not merge', async () => {
    const client = makeMockClient({
      signals: [
        {
          id: 'sig-1',
          title: 'OpenAI Announces New Safety Framework',
          observation_ids: ['obs-a'],
          confidence_score: 60,
        },
      ],
      existingSourceIds: ['source-a'],
    })

    const result = await checkCorroboration(
      'OpenAI Closes New Funding Round At Record Valuation',
      'Models',
      'source-b',
      BASE_DATE,
      client,
    )

    assert.equal(
      result.isCorroboration,
      false,
      'a single shared entity anchor (just the company name) must not be enough to merge two different events',
    )
  })

  test('TWO shared anchors + same action group + same date correctly indicates the same event', async () => {
    const client = makeMockClient({
      signals: [
        {
          id: 'sig-1',
          title: 'Anthropic Unveils Claude Opus 5',
          observation_ids: ['obs-a'],
          confidence_score: 60,
          created_at: BASE_DATE,
        },
      ],
      existingSourceIds: ['source-a'],
    })

    const result = await checkCorroboration(
      'Anthropic Launches Claude Opus 5',
      'Models',
      'source-b',
      BASE_DATE,
      client,
    )
    assert.equal(result.isCorroboration, true)
  })
})

describe('checkCorroboration — a failed source lookup FAILS CLOSED (no corroboration), the real security fix', () => {
  test('a database error on the source lookup refuses corroboration rather than assuming independence', async () => {
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
                          title: 'Anthropic Unveils Claude Opus 5',
                          observation_ids: ['obs-a'],
                          created_at: BASE_DATE,
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

    const result = await checkCorroboration(
      'Anthropic Launches Claude Opus 5',
      'Models',
      'source-b',
      BASE_DATE,
      client,
    )
    assert.equal(result.isCorroboration, false, 'an unverifiable source lookup must fail closed')
  })
})

describe('checkCorroboration — deterministic event key (real hardening: entity+action+version+date, not fuzzy similarity)', () => {
  test('SAME entities + product, but DIFFERENT action (release vs. discontinue) -- must NOT merge, the exact scenario this fix closes', async () => {
    const client = makeMockClient({
      signals: [
        {
          id: 'sig-1',
          title: 'Anthropic Releases Claude Opus 5',
          observation_ids: ['obs-a'],
          confidence_score: 60,
          created_at: BASE_DATE,
        },
      ],
      existingSourceIds: ['source-a'],
    })

    // Same company, same product/version, but a DIFFERENT real event
    // (discontinuation, not release) -- similarity + anchor count
    // alone could not tell these apart; the event key can.
    const result = await checkCorroboration(
      'Anthropic Discontinues Claude Opus 5',
      'Models',
      'source-b',
      BASE_DATE,
      client,
    )

    assert.equal(
      result.isCorroboration,
      false,
      'a release and a discontinuation of the same product are different events and must never be merged',
    )
  })

  test('SAME entities + action, but DIFFERENT version -- must NOT merge', async () => {
    const client = makeMockClient({
      signals: [
        {
          id: 'sig-1',
          title: 'Anthropic Releases Claude Opus 4',
          observation_ids: ['obs-a'],
          confidence_score: 60,
          created_at: BASE_DATE,
        },
      ],
      existingSourceIds: ['source-a'],
    })

    const result = await checkCorroboration(
      'Anthropic Releases Claude Opus 5', // different version number
      'Models',
      'source-b',
      BASE_DATE,
      client,
    )

    assert.equal(
      result.isCorroboration,
      false,
      'different version numbers of the same product are different events',
    )
  })

  test('SAME entities + action + version, but dates too far apart -- must NOT merge', async () => {
    const client = makeMockClient({
      signals: [
        {
          id: 'sig-1',
          title: 'Anthropic Releases Claude Opus 5',
          observation_ids: ['obs-a'],
          confidence_score: 60,
          created_at: '2026-01-01T00:00:00.000Z',
        },
      ],
      existingSourceIds: ['source-a'],
    })

    const result = await checkCorroboration(
      'Anthropic Releases Claude Opus 5',
      'Models',
      'source-b',
      new Date(new Date('2026-01-01T00:00:00.000Z').getTime() + 30 * DAY).toISOString(), // 30 days later
      client,
    )

    assert.equal(
      result.isCorroboration,
      false,
      'a 30-day gap is far outside the corroboration window -- likely an unrelated retrospective/anniversary mention, not the same real-world event',
    )
  })

  test('dates within the window (e.g. 2 days apart) still corroborate -- independent outlets rarely publish on the exact same second', async () => {
    const client = makeMockClient({
      signals: [
        {
          id: 'sig-1',
          title: 'Anthropic Releases Claude Opus 5',
          observation_ids: ['obs-a'],
          confidence_score: 60,
          created_at: BASE_DATE,
        },
      ],
      existingSourceIds: ['source-a'],
    })

    const result = await checkCorroboration(
      'Anthropic Releases Claude Opus 5',
      'Models',
      'source-b',
      new Date(new Date(BASE_DATE).getTime() + 2 * DAY).toISOString(),
      client,
    )

    assert.equal(
      result.isCorroboration,
      true,
      'a 2-day gap is within the real-world reporting-lag window',
    )
  })

  test('a version detected on only ONE side is treated as a mismatch (ambiguous), not a pass', async () => {
    const client = makeMockClient({
      signals: [
        {
          id: 'sig-1',
          title: 'Anthropic Releases Claude Opus', // no version number
          observation_ids: ['obs-a'],
          confidence_score: 60,
          created_at: BASE_DATE,
        },
      ],
      existingSourceIds: ['source-a'],
    })

    const result = await checkCorroboration(
      'Anthropic Releases Claude Opus 5', // has a version number
      'Models',
      'source-b',
      BASE_DATE,
      client,
    )

    assert.equal(
      result.isCorroboration,
      false,
      'a version present on only one side is ambiguous and must not silently pass',
    )
  })

  test('no action verb detectable on either side -- ambiguous, does NOT merge even with matching entities/date', async () => {
    const client = makeMockClient({
      signals: [
        {
          id: 'sig-1',
          title: 'Anthropic and Claude Opus 5 In The News Today',
          observation_ids: ['obs-a'],
          confidence_score: 60,
          created_at: BASE_DATE,
        },
      ],
      existingSourceIds: ['source-a'],
    })

    const result = await checkCorroboration(
      'Claude Opus 5 From Anthropic Getting Attention',
      'Models',
      'source-b',
      BASE_DATE,
      client,
    )

    assert.equal(
      result.isCorroboration,
      false,
      'neither title has a detectable action verb -- this is ambiguous and must remain a separate, single-source observation',
    )
  })
})
