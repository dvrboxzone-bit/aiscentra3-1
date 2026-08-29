import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { parse as parseYaml } from 'yaml'
import { estimateRequestTokens } from '@/lib/ai/client'
import type { ModelRef } from '@/lib/ai/config'

import {
  DURABLE_SIS_V1_CLASSIFIER_MAX_TOKENS,
  assertSafeDiagnostic,
  budgetReservationFor,
  firstRunnableModel,
  invokeOneProvider,
  nextModel,
  nextRunnableModel,
} from '../durable-sis-v1'
import {
  DURABLE_SIS_V1_COMPACT_PARSER_INSTRUCTION,
  DURABLE_SIS_V1_PARSER_JSON_SCHEMA,
  DURABLE_SIS_V1_PARSER_MAX_TOKENS,
  DurableSisParserOutputSchema,
  buildDurableSisParserPrompt,
  durableSisParserRequestOptions,
  maximalDurableParserOutput,
} from '../durable-sis-parser-contract'

const repairMigration = (): string =>
  readFileSync(
    'supabase/migrations/20260828143422_fix_durable_sis_parser_technical_failure.sql',
    'utf8',
  )

const canaryMigration = (): string =>
  readFileSync('supabase/migrations/20260829035009_unlock_durable_sis_canary.sql', 'utf8')

test('canary preserves separate provider reservation units and exact parser budget', () => {
  const messages = [{ role: 'user' as const, content: 'classify this observation' }]
  assert.equal(
    budgetReservationFor(
      messages,
      { provider: 'groq', model: 'openai/gpt-oss-20b' },
      DURABLE_SIS_V1_CLASSIFIER_MAX_TOKENS,
    ).unitKind,
    'groq_tokens',
  )
  assert.equal(
    budgetReservationFor(
      messages,
      { provider: 'groq', model: 'openai/gpt-oss-20b' },
      DURABLE_SIS_V1_PARSER_MAX_TOKENS,
    ).units,
    estimateRequestTokens(messages, DURABLE_SIS_V1_PARSER_MAX_TOKENS),
  )
  assert.deepEqual(
    budgetReservationFor(
      messages,
      {
        provider: 'cloudflare',
        model: '@cf/zai-org/glm-4.7-flash',
      },
      DURABLE_SIS_V1_PARSER_MAX_TOKENS,
    ),
    { unitKind: 'provider_request', units: 1 },
  )
})

test('maximum strict parser JSON contract fits the derived 2048-token output budget', () => {
  const maximum = maximalDurableParserOutput()
  assert.deepEqual(DurableSisParserOutputSchema.parse(maximum), maximum)
  assert.equal(DURABLE_SIS_V1_PARSER_MAX_TOKENS, 2048)
  assert.ok(Math.ceil(Buffer.byteLength(JSON.stringify(maximum), 'utf8') / 2) <= 2048)
  assert.equal(
    DurableSisParserOutputSchema.safeParse({ ...maximum, unbounded_extra: 'forbidden' }).success,
    false,
  )
})

test('production Groq schema-validation case is closed by strict constrained decoding', () => {
  const productionDiagnostic = {
    run_id: '4f017a68-a7c2-4347-9388-9c3750e99bb6',
    provider: 'groq',
    model: 'openai/gpt-oss-120b',
    type: 'schema_validation',
    http_status: 200,
    finish_reason: 'stop',
    content_length: 796,
  }
  const options = durableSisParserRequestOptions('groq')

  assert.equal(productionDiagnostic.type, 'schema_validation')
  assert.deepEqual(options, {
    reasoningEffort: 'low',
    responseFormat: {
      type: 'json_schema',
      json_schema: {
        name: 'durable_sis_v1_parser',
        strict: true,
        schema: DURABLE_SIS_V1_PARSER_JSON_SCHEMA,
      },
    },
  })
  assert.equal(DURABLE_SIS_V1_PARSER_JSON_SCHEMA.additionalProperties, false)
  assert.deepEqual(
    new Set(DURABLE_SIS_V1_PARSER_JSON_SCHEMA.required),
    new Set(Object.keys(DURABLE_SIS_V1_PARSER_JSON_SCHEMA.properties)),
  )
})

test('production Cloudflare truncated-envelope case gets bounded JSON schema and reasoning', () => {
  const productionDiagnostic = {
    run_id: '4f017a68-a7c2-4347-9388-9c3750e99bb6',
    provider: 'cloudflare',
    model: '@cf/zai-org/glm-4.7-flash',
    type: 'invalid_response_envelope',
    http_status: 200,
    finish_reason: 'length',
    content_length: 17_268,
  }
  const options = durableSisParserRequestOptions('cloudflare')

  assert.equal(productionDiagnostic.finish_reason, 'length')
  assert.deepEqual(options, {
    reasoningEffort: 'low',
    responseFormat: {
      type: 'json_schema',
      json_schema: DURABLE_SIS_V1_PARSER_JSON_SCHEMA,
    },
  })
  assert.equal(DURABLE_SIS_V1_PARSER_MAX_TOKENS, 2048)
})

test('durable parser prompt is bounded and keeps evidence and quality rules content-independent', () => {
  const prompt = buildDurableSisParserPrompt({
    title: `Title ${'x'.repeat(2_000)}`,
    content: `Evidence ${'y'.repeat(20_000)}`,
    sourceName: `Source ${'z'.repeat(1_000)}`,
    sourceType: 'research',
    sourceTrustScore: 0.8,
    candidateCategory: 'RESEARCH',
  })

  assert.ok(prompt.length < 1_200)
  assert.match(prompt, /type=research \| trust=0\.8/)
  assert.match(DURABLE_SIS_V1_COMPACT_PARSER_INSTRUCTION, /Never invent numbers/)
  assert.match(DURABLE_SIS_V1_COMPACT_PARSER_INSTRUCTION, /corroboration_factor=2/)
  assert.match(DURABLE_SIS_V1_COMPACT_PARSER_INSTRUCTION, /cap novelty_factor at 7/)
  assert.doesNotMatch(DURABLE_SIS_V1_COMPACT_PARSER_INSTRUCTION, /EXAMPLE INPUT|worked examples/i)
})

test('one failed stage advances exactly one model and diagnostics reject raw fields', () => {
  const chain = [
    { provider: 'groq' as const, model: '20b' },
    { provider: 'groq' as const, model: '120b' },
    { provider: 'cloudflare' as const, model: 'cf' },
  ]
  const [first, second, third] = chain
  assert.ok(first && second && third)
  assert.deepEqual(nextModel(chain, first), second)
  assert.deepEqual(nextModel(chain, second), third)
  assert.equal(nextModel(chain, third), null)
  assert.doesNotThrow(() =>
    assertSafeDiagnostic({
      type: 'output_truncated',
      provider: 'groq',
      model: '120b',
      http_status: 200,
      finish_reason: 'length',
      content_length: 0,
    }),
  )
})

test('a fallback without a full local attempt window is skipped before reservation', () => {
  const chain = [
    { provider: 'groq' as const, model: 'primary' },
    { provider: 'groq' as const, model: 'locally-blocked' },
    { provider: 'cloudflare' as const, model: 'independent' },
  ]
  const messages = [{ role: 'user' as const, content: 'bounded parser input' }]
  const probe = (ref: ModelRef): boolean => ref.model !== 'locally-blocked'
  const [current] = chain
  assert.ok(current)
  assert.deepEqual(
    nextRunnableModel(chain, current, messages, DURABLE_SIS_V1_PARSER_MAX_TOKENS, probe),
    chain[2],
  )
  assert.deepEqual(
    firstRunnableModel(chain.slice(1), messages, DURABLE_SIS_V1_PARSER_MAX_TOKENS, probe),
    chain[2],
  )
})

test('one queue delivery invokes exactly one provider attempt', async () => {
  let calls = 0
  const value = await invokeOneProvider(async () => {
    calls += 1
    return 'typed-result'
  })
  assert.equal(value, 'typed-result')
  assert.equal(calls, 1)
})

test('migration uses durable read/visibility, never pop, and installs disabled kill switch', () => {
  const sql = readFileSync(
    'supabase/migrations/20260825121411_add_durable_sis_v1_pgmq_control.sql',
    'utf8',
  )
  assert.match(sql, /pgmq\.read\('durable_sis_v1', p_visibility_seconds, 1\)/)
  assert.doesNotMatch(sql, /pgmq\.pop/i)
  assert.match(sql, /execution_enabled boolean not null default false/i)
  assert.match(sql, /if coalesce\(v_enabled, false\) is false then[\s\S]*status='PAUSED'/i)
  assert.match(sql, /unit_kind = 'groq_tokens'/)
  assert.match(sql, /unit_kind = 'provider_request'/)
  assert.match(
    sql,
    /pgmq\.send\('durable_sis_v1',jsonb_build_object\('stage','FINALIZE','run_id',v_attempt\.run_id\)\)[\s\S]*pgmq\.archive\('durable_sis_v1',p_message_id\)/,
  )
  assert.match(sql, /observation already finalized/)
  assert.match(sql, /v_attempt\.status not in \('QUEUED','RUNNING'\)/)
  assert.match(
    sql,
    /select \* into v_existing[\s\S]*if found then[\s\S]*pgmq\.archive[\s\S]*return jsonb_build_object[\s\S]*run not ready/,
  )
})

test('parser success persists a durable FINALIZE delivery before archiving provider work', () => {
  const sql = readFileSync(
    'supabase/migrations/20260825121411_add_durable_sis_v1_pgmq_control.sql',
    'utf8',
  )
  assert.match(sql, /finalization_outcome text/)
  assert.match(sql, /finalization_signal jsonb/)
  assert.match(sql, /finalization_decision jsonb/)
  assert.match(sql, /finalization_message_id bigint/)
  assert.match(
    sql,
    /if v_msg\.message->>'stage' = 'FINALIZE' then[\s\S]*'FINALIZE'::text[\s\S]*null::text, null::text/,
  )
  assert.match(
    sql,
    /create or replace function public\.finalize_durable_sis_v1\(\s*p_run_id uuid, p_message_id bigint[\s\S]*v_run\.finalization_outcome/,
  )
})

test('technical chain and fallback-budget exhaustion fail the run without content finalization', () => {
  const sql = repairMigration()
  const completionFunction = sql.split(
    'create or replace function public.complete_durable_sis_v1_attempt',
  )[1]
  assert.ok(completionFunction)
  const budgetBranch = completionFunction.match(
    /if not public\.reserve_durable_sis_v1_budget[\s\S]*?return jsonb_build_object\('status','FAILED','stage',p_next_stage,'reason','budget_unavailable'[\s\S]*?end if;/,
  )?.[0]
  assert.ok(budgetBranch)
  assert.match(budgetBranch, /status='TERMINAL'/)
  assert.match(budgetBranch, /status='FAILED'/)
  assert.match(budgetBranch, /finalization_outcome=null/)
  assert.match(budgetBranch, /pgmq\.archive\('durable_sis_v1',p_message_id\)/)
  assert.doesNotMatch(budgetBranch, /pgmq\.send|READY_TO_FINALIZE|signal_decision_log/)
  assert.match(sql, /create or replace function public\.fail_durable_sis_v1_stage/)
  assert.match(sql, /set status='FAILED'/)
})

test('FAILED runs are retryable through a generic recovery ledger without hardcoded incident ids', () => {
  const sql = repairMigration()
  assert.match(sql, /where status <> 'FAILED'/)
  assert.match(sql, /sis_execution_runs_one_nonfailed_per_observation_idx/)
  assert.match(sql, /sis_execution_recoveries/)
  assert.match(sql, /recover_durable_sis_v1_technical_failure/)
  assert.match(sql, /decision_log_id=d\.id/)
  assert.doesNotMatch(sql, /772de061|ca354cfb/)
  assert.doesNotMatch(sql, /delete from public\.signal_decision_log/i)
})

test('ordinary canary migration replaces fixed-ID checks with production invariants', () => {
  const sql = canaryMigration()
  assert.match(
    sql,
    /drop constraint if exists sis_execution_controls_control_observation_id_check/i,
  )
  assert.match(sql, /drop constraint if exists sis_execution_runs_observation_id_check/i)
  assert.match(
    sql,
    /create unique index sis_execution_runs_one_nonfailed_per_observation_idx\s+on public\.sis_execution_runs\(observation_id\)\s+where status <> 'FAILED'/i,
  )
  assert.match(
    sql,
    /start_durable_sis_v1_control\(\s*p_observation_id uuid,[\s\S]*?execution_enabled[\s\S]*?observation\.processed is false[\s\S]*?observation\.signal_id is null[\s\S]*?observation\.qualification_result is null[\s\S]*?observation\.rejection_code is null[\s\S]*?observation\.url_verified_ok is true[\s\S]*?source\.status = 'ACTIVE'/i,
  )
  assert.match(sql, /not exists \([\s\S]*?sis_execution_recoveries recovery/i)
  assert.match(sql, /reserve_durable_sis_v1_budget\(v_attempt_id, p_units, p_unit_kind\)/i)
  assert.doesNotMatch(sql, /e4275483-39e4-4441-84a2-0a1df546cf07/i)
  assert.doesNotMatch(
    sql,
    /delete from public\.(sis_execution_recoveries|signal_decision_log|signals)/i,
  )
})

test('manual canary workflow is owner-only, bounded, one-ID, and cannot call batch/replay/cron', () => {
  const workflow = readFileSync('.github/workflows/targeted-sis-durable-v1-control.yml', 'utf8')
  const parsed = parseYaml(workflow) as Record<string, unknown>
  assert.equal(typeof parsed, 'object')
  assert.match(workflow, /workflow_dispatch:\s*\n\s+inputs:/m)
  assert.match(workflow, /observation_id:/)
  assert.match(workflow, /confirmation:/)
  assert.match(workflow, /github\.actor/)
  assert.match(workflow, /github\.repository_owner/)
  assert.match(workflow, /test "\$REF_NAME" = "main"/)
  assert.match(workflow, /RUN_ONE_DURABLE_SIS_CANARY/)
  assert.doesNotMatch(workflow, /schedule:/)
  assert.match(workflow, /environment: production/)
  assert.match(workflow, /group: enrich-batch/)
  assert.equal((workflow.match(/--retry 0/g) ?? []).length, 2)
  assert.equal((workflow.match(/--request POST/g) ?? []).length, 2)
  assert.match(workflow, /for pass in 1 2 3 4 5 6 7 8 9 10 11 12/)
  assert.match(workflow, /\{observation_id:\$observation_id\}/)
  assert.match(workflow, /test "\$started" = 1/)
  assert.match(workflow, /api\/internal\/sis-durable-control\/start/)
  assert.match(workflow, /api\/internal\/sis-durable-control\/stage/)
  assert.doesNotMatch(workflow, /api\/enrich\/batch|api\/internal\/sis-replay|api\/cron\//)
})

test('production schema gate requires PGMQ and every durable SIS contract', () => {
  const gate = readFileSync('scripts/release/schema-check.sql', 'utf8')
  for (const object of [
    'pgmq',
    'durable_sis_v1',
    'sis_execution_controls',
    'sis_execution_runs',
    'sis_execution_attempts',
    'sis_provider_budget_reservations',
    'sis_execution_finalizations',
    'claim_durable_sis_v1_attempt',
    'finalize_durable_sis_v1',
    'finalization_outcome',
    'finalization_message_id',
    'start_durable_sis_v1_control\\(uuid,text,text,integer,text\\)',
    'finalize_durable_sis_v1\\(uuid,bigint\\)',
  ]) {
    assert.match(gate, new RegExp(object))
  }
})
