import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'

import { POST } from '@/app/api/internal/sis-replay/route'
import type { ObservationRow } from '@/modules/observations/queries'
import { SIS_STRUCTURED_OUTPUT_MAX_TOKENS } from '@/modules/signals/engine'
import {
  parseTargetedReplayRequest,
  runTargetedSisReplay,
  TARGETED_SIS_REPAIR_KEY,
  TARGETED_SIS_REPLAY_ALLOWLIST,
  TARGETED_SIS_REPLAY_V1_KEY,
  TARGETED_SIS_REPLAY_V2_KEY,
  TARGETED_SIS_REPLAY_V2_MARKER_FIELD,
  TARGETED_SIS_REPLAY_V3_CONTROL_ID,
  TARGETED_SIS_REPLAY_V3_CONTROL_KEY,
  TARGETED_SIS_REPLAY_V3_CONTROL_MARKER_FIELD,
  isTargetedReplayV3ControlEligible,
  parseTargetedReplayV3ControlRequest,
  type TargetedReplayItemResult,
} from '@/modules/signals/targeted-sis-replay'

const NOW = Date.parse('2026-08-24T12:00:00.000Z')

function observation(id: string, metadata: Record<string, unknown> = {}): ObservationRow {
  return {
    id,
    source_id: `source-${id}`,
    title: 'Targeted SIS replay fixture',
    content: 'Offline fixture content',
    url: 'https://example.test/fixture',
    published_at: '2026-08-23T00:00:00.000Z',
    collected_at: '2026-08-23T00:00:00.000Z',
    metadata: {
      repair_key: TARGETED_SIS_REPAIR_KEY,
      retry_after: '2026-08-24T00:00:00.000Z',
      ...metadata,
    },
    processed: false,
    processing_error: null,
    signal_id: null,
    rejection_code: null,
  } as unknown as ObservationRow
}

describe('targeted SIS replay', () => {
  test('requires CRON_SECRET before body parsing or privileged access', async () => {
    const savedSecret = process.env['CRON_SECRET']
    delete process.env['CRON_SECRET']
    try {
      const response = await POST(
        new Request('https://example.test/api/internal/sis-replay', { method: 'POST' }),
      )
      assert.equal(response.status, 401)
      assert.deepEqual(await response.json(), { error: 'Unauthorized' })
    } finally {
      if (savedSecret === undefined) delete process.env['CRON_SECRET']
      else process.env['CRON_SECRET'] = savedSecret
    }
  })

  test('server-side allowlist contains exactly the nine repaired observation IDs', () => {
    assert.deepEqual(TARGETED_SIS_REPLAY_ALLOWLIST, [
      'e4275483-39e4-4441-84a2-0a1df546cf07',
      'ec86e548-8394-4c45-8353-7ba588f23cf3',
      'fc22b35a-776b-4666-aabc-64ea1a198c34',
      'bcf826e4-069c-4627-a4ab-6635ce3e1f7e',
      '5e0938e3-feb2-4531-9ebb-1e53164d219d',
      'cb043c56-7be5-4e9d-9144-2c9c407d9655',
      '91c78285-f310-4dfa-a0ca-0953e8cfdd40',
      '948419ea-27e9-4213-b692-f80c04611cfa',
      'de90407c-d4b9-4eee-862f-12a549f9544d',
    ])
  })

  test('rejects a request containing a foreign observation ID before any processing', async () => {
    const parsed = parseTargetedReplayRequest({
      observationIds: ['00000000-0000-4000-8000-000000000001'],
    })
    assert.deepEqual(parsed, {
      ok: false,
      error: 'One or more observationIds are not allowlisted',
    })
  })

  test('processes exactly nine allowlisted rows once and never calls a general batch loader', async () => {
    const rows = TARGETED_SIS_REPLAY_ALLOWLIST.map((id) => observation(id))
    const claimed = new Set<string>()
    const attempted: string[] = []

    const summary = await runTargetedSisReplay(TARGETED_SIS_REPLAY_ALLOWLIST, NOW + 120_000, {
      loadEligible: async (ids) => {
        assert.deepEqual(ids, TARGETED_SIS_REPLAY_ALLOWLIST)
        return rows
      },
      claim: async (row) => {
        if (claimed.has(row.id)) return null
        claimed.add(row.id)
        return observation(row.id, {
          [TARGETED_SIS_REPLAY_V2_MARKER_FIELD]: TARGETED_SIS_REPLAY_V2_KEY,
        })
      },
      processOne: async (row): Promise<TargetedReplayItemResult> => {
        attempted.push(row.id)
        return { disposition: 'valid' }
      },
      now: () => NOW,
    })

    assert.deepEqual(attempted, TARGETED_SIS_REPLAY_ALLOWLIST)
    assert.deepEqual(summary, {
      requested: 9,
      eligible: 9,
      attempted: 9,
      valid: 9,
      rejected: 0,
      retried: 0,
      failed: 0,
      deadline_exceeded: 0,
      diagnostic_counts: {
        json_parse: 0,
        schema_validation: 0,
        output_truncated: 0,
        invalid_response_envelope: 0,
      },
      complete: true,
    })
  })

  test('internal route never invokes the general batch endpoint or queue cycle', () => {
    const source = readFileSync(resolve('src/app/api/internal/sis-replay/route.ts'), 'utf8')
    assert.doesNotMatch(source, /fetch\s*\(\s*['"`]\/api\/enrich\/batch/)
    assert.doesNotMatch(source, /runEnrichmentCycle\s*\(/)
    assert.match(source, /General observation queue access is forbidden/)
  })

  test('a durable v1 marker does not block the separate v2 campaign', async () => {
    const id = TARGETED_SIS_REPLAY_ALLOWLIST[0]
    const v1Row = observation(id, { targeted_sis_replay_key: TARGETED_SIS_REPLAY_V1_KEY })
    let attempts = 0

    const summary = await runTargetedSisReplay([id], NOW + 120_000, {
      loadEligible: async () => [v1Row],
      claim: async (row) => {
        assert.equal(row.metadata?.['targeted_sis_replay_key'], TARGETED_SIS_REPLAY_V1_KEY)
        return observation(row.id, {
          ...row.metadata,
          [TARGETED_SIS_REPLAY_V2_MARKER_FIELD]: TARGETED_SIS_REPLAY_V2_KEY,
        })
      },
      processOne: async () => {
        attempts++
        return { disposition: 'retried', diagnostic: 'output_truncated' }
      },
      now: () => NOW,
    })

    assert.equal(summary.eligible, 1)
    assert.equal(summary.attempted, 1)
    assert.equal(attempts, 1)
  })

  test('a v2 marker blocks a second v2 attempt even when v1 history is present', async () => {
    const replayedRows = TARGETED_SIS_REPLAY_ALLOWLIST.map((id) =>
      observation(id, {
        targeted_sis_replay_key: TARGETED_SIS_REPLAY_V1_KEY,
        [TARGETED_SIS_REPLAY_V2_MARKER_FIELD]: TARGETED_SIS_REPLAY_V2_KEY,
      }),
    )
    let processCalls = 0

    const summary = await runTargetedSisReplay(TARGETED_SIS_REPLAY_ALLOWLIST, NOW + 120_000, {
      loadEligible: async () => replayedRows,
      claim: async () => {
        throw new Error('claim must not run for already replayed rows')
      },
      processOne: async () => {
        processCalls++
        return { disposition: 'failed' }
      },
      now: () => NOW,
    })

    assert.equal(processCalls, 0)
    assert.equal(summary.eligible, 0)
    assert.equal(summary.attempted, 0)
    assert.equal(summary.complete, true)
  })

  test('v1/v2 history does not block v3 control, while its date-stamped marker does', () => {
    const history = observation(TARGETED_SIS_REPLAY_V3_CONTROL_ID, {
      targeted_sis_replay_key: TARGETED_SIS_REPLAY_V1_KEY,
      [TARGETED_SIS_REPLAY_V2_MARKER_FIELD]: TARGETED_SIS_REPLAY_V2_KEY,
    })
    assert.equal(isTargetedReplayV3ControlEligible(history, NOW), true)
    assert.equal(
      isTargetedReplayV3ControlEligible(
        observation(TARGETED_SIS_REPLAY_V3_CONTROL_ID, {
          ...history.metadata,
          [TARGETED_SIS_REPLAY_V3_CONTROL_MARKER_FIELD]: TARGETED_SIS_REPLAY_V3_CONTROL_KEY,
        }),
        NOW,
      ),
      false,
    )
  })

  test('v3 parser accepts only one fixed control ID and no seven-ID cohort', () => {
    assert.deepEqual(
      parseTargetedReplayV3ControlRequest({
        observationIds: [TARGETED_SIS_REPLAY_V3_CONTROL_ID],
      }),
      { ok: true, observationIds: [TARGETED_SIS_REPLAY_V3_CONTROL_ID] },
    )
    assert.equal(
      parseTargetedReplayV3ControlRequest({
        observationIds: TARGETED_SIS_REPLAY_ALLOWLIST.slice(0, 7),
      }).ok,
      false,
    )
  })

  test('insufficient preclaim budget writes no campaign marker and does not mutate observation', async () => {
    const row = observation(TARGETED_SIS_REPLAY_V3_CONTROL_ID, {
      targeted_sis_replay_key: TARGETED_SIS_REPLAY_V1_KEY,
      [TARGETED_SIS_REPLAY_V2_MARKER_FIELD]: TARGETED_SIS_REPLAY_V2_KEY,
    })
    const metadataBefore = structuredClone(row.metadata)
    let claims = 0
    let attempts = 0
    const summary = await runTargetedSisReplay([row.id], NOW + 120_000, {
      loadEligible: async () => [row],
      isEligible: isTargetedReplayV3ControlEligible,
      canStart: async () => false,
      claim: async () => {
        claims++
        return row
      },
      processOne: async () => {
        attempts++
        return { disposition: 'valid' }
      },
      now: () => NOW,
    })

    assert.equal(summary.eligible, 1)
    assert.equal(summary.attempted, 0)
    assert.equal(summary.complete, false)
    assert.equal(claims, 0)
    assert.equal(attempts, 0)
    assert.deepEqual(row.metadata, metadataBefore)
  })

  test('SIS structured output alone uses the evidence-backed 1024-token cap', () => {
    const engineSource = readFileSync(resolve('src/modules/signals/engine.ts'), 'utf8')

    assert.equal(SIS_STRUCTURED_OUTPUT_MAX_TOKENS, 1024)
    assert.match(engineSource, /maxTokens:\s*SIS_STRUCTURED_OUTPUT_MAX_TOKENS/)
    assert.equal((engineSource.match(/SIS_STRUCTURED_OUTPUT_MAX_TOKENS/g) ?? []).length, 2)
  })

  test('a failed claim makes the invocation incomplete instead of reporting success', async () => {
    const id = TARGETED_SIS_REPLAY_ALLOWLIST[0]
    const summary = await runTargetedSisReplay([id], NOW + 120_000, {
      loadEligible: async () => [observation(id)],
      claim: async () => null,
      processOne: async () => {
        throw new Error('process must not run without a durable claim')
      },
      now: () => NOW,
    })

    assert.equal(summary.eligible, 1)
    assert.equal(summary.attempted, 0)
    assert.equal(summary.complete, false)
  })

  test('aggregates dispositions and typed structured-output diagnostics', async () => {
    const results: TargetedReplayItemResult[] = [
      { disposition: 'valid' },
      { disposition: 'rejected', diagnostic: 'schema_validation' },
      { disposition: 'retried', diagnostic: 'output_truncated' },
      { disposition: 'failed', diagnostic: 'json_parse' },
      { disposition: 'retried', diagnostic: 'invalid_response_envelope' },
    ]
    const ids = TARGETED_SIS_REPLAY_ALLOWLIST.slice(0, results.length)

    const summary = await runTargetedSisReplay(ids, NOW + 120_000, {
      loadEligible: async () => ids.map((id) => observation(id)),
      claim: async (row) => row,
      processOne: async () => {
        const result = results.shift()
        if (!result) throw new Error('fixture result exhausted')
        return result
      },
      now: () => NOW,
    })

    assert.equal(summary.attempted, 5)
    assert.equal(summary.valid, 1)
    assert.equal(summary.rejected, 1)
    assert.equal(summary.retried, 2)
    assert.equal(summary.failed, 1)
    assert.deepEqual(summary.diagnostic_counts, {
      json_parse: 1,
      schema_validation: 1,
      output_truncated: 1,
      invalid_response_envelope: 1,
    })
  })

  test('deadline retry is counted separately without hiding prior model-contract defects', async () => {
    const id = TARGETED_SIS_REPLAY_V3_CONTROL_ID
    const summary = await runTargetedSisReplay([id], NOW + 120_000, {
      loadEligible: async () => [observation(id)],
      claim: async (row) => row,
      processOne: async () => ({
        disposition: 'retried',
        diagnostics: ['invalid_response_envelope'],
        deadlineExceeded: true,
      }),
      now: () => NOW,
    })
    assert.equal(summary.retried, 1)
    assert.equal(summary.deadline_exceeded, 1)
    assert.equal(summary.diagnostic_counts.invalid_response_envelope, 1)
  })
})

describe('targeted SIS replay v3 control workflow contract', () => {
  const workflowPath = '.github/workflows/targeted-sis-replay-v3-control.yml'
  const workflow = (): string => readFileSync(workflowPath, 'utf8')

  test('is syntactically valid YAML', () => {
    const parsed = parseYaml(workflow()) as Record<string, unknown>
    assert.equal(typeof parsed['on'], 'object')
    assert.equal(typeof parsed['jobs'], 'object')
  })

  test('is one manual production control with no inputs, loops, cohort, batch or cron', () => {
    const source = workflow()
    const triggerBlock = /^on:\r?\n([\s\S]*?)^permissions:/m.exec(source)?.[1] ?? ''
    assert.match(triggerBlock, /^ {2}workflow_dispatch:\s*$/m)
    assert.doesNotMatch(triggerBlock, /inputs:|schedule:|push:|pull_request:/)
    assert.equal((source.match(/^ {4}environment:\s*production\s*$/gm) ?? []).length, 1)
    assert.equal((source.match(/\bcurl\b/g) ?? []).length, 1)
    assert.doesNotMatch(source, /for\s+|while\s+|\/api\/enrich\/batch|\/api\/cron\//)
    assert.match(source, /--retry 0/)
    assert.match(source, /group:\s*enrich-batch/)
  })

  test('uses the 20260825 v3 marker and sends only the fixed control ID', () => {
    const source = workflow()
    assert.match(source, new RegExp(TARGETED_SIS_REPLAY_V3_CONTROL_KEY))
    const bodyMatch = /--data-binary '([^']+)'/.exec(source)
    assert.ok(bodyMatch)
    assert.deepEqual(JSON.parse(bodyMatch[1] ?? ''), {
      observationIds: [TARGETED_SIS_REPLAY_V3_CONTROL_ID],
    })
    for (const id of TARGETED_SIS_REPLAY_ALLOWLIST.slice(1))
      assert.doesNotMatch(source, new RegExp(id))
  })

  test('fails unless the exact one-control success contract is satisfied', () => {
    const source = workflow()
    assert.match(source, /"\$initial_eligible" -ne 1/)
    assert.match(source, /"\$attempted" -ne 1/)
    assert.match(source, /resolved="\$\(jq -r '\.valid \+ \.rejected'/)
    assert.match(source, /"\$resolved" -ne 1/)
    assert.match(source, /"\$retried" -ne 0/)
    assert.match(source, /"\$failed" -ne 0/)
    assert.match(source, /"\$deadline_exceeded" -ne 0/)
    assert.match(source, /"\$final_eligible" -ne 0/)
    assert.match(source, /"\$complete" != "true"/)
    assert.match(source, /invalid_response_envelope/)
    assert.doesNotMatch(source, /raw[_ -]?(prompt|response|content)/i)
  })
})

describe('targeted SIS replay workflow contract', () => {
  const workflowPath = '.github/workflows/targeted-sis-replay.yml'
  const workflow = (): string => readFileSync(workflowPath, 'utf8')

  test('is manual-only, has no inputs, and requires the single production approval boundary', () => {
    const source = workflow()
    const triggerBlock = /^on:\r?\n([\s\S]*?)^permissions:/m.exec(source)?.[1] ?? ''

    assert.match(triggerBlock, /^ {2}workflow_dispatch:\s*$/m)
    assert.doesNotMatch(
      triggerBlock,
      /^ {2}(schedule|push|pull_request|repository_dispatch|workflow_call):/m,
    )
    assert.doesNotMatch(triggerBlock, /^ {4}inputs:/m)
    assert.equal((source.match(/^ {4}environment:\s*production\s*$/gm) ?? []).length, 1)
  })

  test('uses the existing secret and only the exact internal endpoint in a nine-pass sequential loop', () => {
    const source = workflow()

    assert.match(source, /CRON_SECRET:\s*\$\{\{ secrets\.CRON_SECRET \}\}/)
    assert.match(source, /--header "x-cron-secret: \$\{CRON_SECRET\}"/)
    assert.equal(
      (source.match(/https:\/\/aiscentra\.com\/api\/internal\/sis-replay/g) ?? []).length,
      1,
    )
    assert.equal((source.match(/\bcurl\b/g) ?? []).length, 1)
    assert.match(source, /--retry 0/)
    assert.match(source, /--max-time 65/)
    assert.match(source, /for pass in \{1\.\.9\}; do/)
    assert.doesNotMatch(source, /\/api\/enrich\/batch|\/api\/cron\/|\/api\/pipeline/)
    assert.doesNotMatch(source, /\bcat\s+|set\s+-x|echo[^\n]*\$\{CRON_SECRET\}/)
  })

  test('sends exactly the nine server-side allowlisted IDs and no request fields besides observationIds', () => {
    const source = workflow()
    const bodyMatch = /--data-binary '([^']+)'/.exec(source)
    assert.ok(bodyMatch, 'workflow must send one literal JSON body')

    const body = JSON.parse(bodyMatch[1] ?? '') as Record<string, unknown>
    assert.deepEqual(Object.keys(body), ['observationIds'])
    assert.deepEqual(body['observationIds'], TARGETED_SIS_REPLAY_ALLOWLIST)
  })

  test('accepts only progressing 503 passes and requires initial-eligible attempts plus exhaustion', () => {
    const source = workflow()

    assert.match(
      source,
      /concurrency:\r?\n {2}group:\s*enrich-batch\r?\n {2}cancel-in-progress:\s*false/,
    )
    for (const field of [
      'requested',
      'eligible',
      'attempted',
      'valid',
      'rejected',
      'retried',
      'failed',
      'diagnostic_counts',
      'complete',
    ]) {
      assert.match(source, new RegExp(`\\b${field}\\b`))
    }
    assert.match(
      source,
      /invalid_response_envelope:\s*\.diagnostic_counts\.invalid_response_envelope/,
    )
    assert.match(
      source,
      /\.diagnostic_counts\.invalid_response_envelope\]\s*\|\s*all\(type == "number" and \. >= 0 and floor == \.\)/,
    )
    assert.match(source, /"\$HTTP_STATUS" != "200" && "\$HTTP_STATUS" != "503"/)
    assert.match(source, /"\$HTTP_STATUS" == "503"/)
    assert.match(source, /"\$complete" != "false" \|\| "\$attempted" -eq 0/)
    assert.match(source, /total_attempted=\$\(\(total_attempted \+ attempted\)\)/)
    assert.match(source, /initial_eligible="\$eligible"/)
    assert.match(source, /"\$total_attempted" -ne "\$initial_eligible"/)
    assert.doesNotMatch(source, /"\$total_attempted" -ne 9/)
    assert.match(source, /"\$final_eligible" -ne 0/)
    assert.match(source, /"\$eligible" -eq 0/)
    assert.match(source, /completed=true/)
    assert.doesNotMatch(source, /raw[_ -]?output|raw[_ -]?content|response body/i)
    assert.match(source, /echo "Summary: \$\{totals\}"/)
    assert.match(source, /exit 1/)
  })

  test('supports initial eligible=8 and emits a count-only partial summary on every failure', () => {
    const source = workflow()
    const initialEligible = 8
    const attemptedAcrossPasses = [3, 3, 2]

    assert.equal(
      attemptedAcrossPasses.reduce((total, attempted) => total + attempted, 0),
      initialEligible,
    )
    assert.match(source, /initial_eligible_captured=false/)
    assert.match(source, /if \[\[ "\$initial_eligible_captured" != "true" \]\]/)
    assert.match(source, /trap on_error ERR/)
    assert.match(source, /if \[\[ "\$summary_emitted" != "true" \]\]; then\s+print_summary false/s)
    assert.match(source, /complete: \(\$complete == "true"\)/)
    assert.doesNotMatch(source, /echo[^\n]*response_file/i)
    assert.doesNotMatch(source, /echo[^\n]*\$\{?summary\}?\b/i)
  })
})
