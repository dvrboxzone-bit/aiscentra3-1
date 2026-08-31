import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, test } from 'node:test'

const migration = readFileSync(
  resolve('supabase/migrations/20260831104450_draft_signal_corroboration_approval.sql'),
  'utf8',
)
const migrationSql = migration.replace(/--.*$/gm, '')
const publicQueries = readFileSync(resolve('src/modules/signals/queries.ts'), 'utf8')
const digestRoute = readFileSync(resolve('src/app/api/cron/signals-digest/route.ts'), 'utf8')

describe('DRAFT corroboration approval contract', () => {
  test('is service-role-only, manual, atomic, and DRAFT/SIGNAL/PENDING constrained', () => {
    assert.match(migration, /CREATE OR REPLACE FUNCTION public\.corroborate_draft_signal/)
    assert.match(migration, /SECURITY DEFINER/)
    assert.match(
      migration,
      /REVOKE EXECUTE ON FUNCTION public\.corroborate_draft_signal\(UUID, UUID\)[\s\S]*?FROM PUBLIC, anon, authenticated/,
    )
    assert.match(migration, /v_signal\.status <> 'DRAFT'/)
    assert.match(migration, /v_signal\.quality_state <> 'PENDING'/)
    assert.match(migration, /v_signal\.intelligence_type <> 'SIGNAL'/)
    assert.doesNotMatch(migration, /CREATE\s+(OR\s+REPLACE\s+)?(PROCEDURE|FUNCTION)[\s\S]*cron/i)
  })

  test('uses canonical provenance roots and unknown roots never count', () => {
    assert.match(migration, /ADD COLUMN IF NOT EXISTS provenance_root TEXT/)
    assert.match(migration, /ELSE NULL/)
    assert.match(migration, /src\.provenance_root IS NOT NULL/)
    assert.match(migration, /cardinality\(v_roots\), 0\) < 2/)
    assert.match(migration, /array_agg\(DISTINCT src\.provenance_root/)
  })

  test('centralizes approval predicates and preserves the existing thresholds', () => {
    assert.match(migration, /signal_meets_quality_approval_predicates/)
    for (const invariant of [
      /status IN \('ACTIVE', 'PROMOTED'\)/,
      /intelligence_type IN \('SIGNAL', 'CRITICAL_SIGNAL'\)/,
      /has_verified_source = TRUE/,
      /verification_state IN \('CORROBORATED', 'VERIFIED'\)/,
      /qualification_score >= 6\.0/,
      /sis_final >= 6\.0/,
      /anti_hype_score >= 3\.0/,
      /cardinality\(p_signal\.validation_flags\) = 0/,
      /cardinality\(p_signal\.observation_ids\) >= 2/,
    ]) {
      assert.match(migration, invariant)
    }
  })

  test('records exact evidence and makes both audit ledgers append-only/idempotent', () => {
    assert.match(migration, /signal_corroboration_audits/)
    assert.match(migration, /UNIQUE \(signal_id, observation_id\)/)
    assert.match(migration, /evidence_observation_ids UUID\[\]/)
    assert.match(migration, /evidence_provenance_roots TEXT\[\]/)
    assert.match(migration, /signal_corroboration_audits is append-only/)
    assert.match(migration, /'observation_ids', NEW\.observation_ids/)
    assert.match(migration, /'provenance_roots', v_roots/)
    assert.match(migration, /'duplicate', true/)
  })

  test('does not rewrite classifier/parser/content-decision records or introduce side effects', () => {
    assert.doesNotMatch(migrationSql, /UPDATE public\.signal_decision_log/i)
    assert.doesNotMatch(migrationSql, /INSERT INTO public\.signal_decision_log/i)
    assert.doesNotMatch(
      migrationSql,
      /sis_execution_attempts|sis_execution_runs|pgmq|fetch\(|resend/i,
    )
    assert.doesNotMatch(migrationSql, /CREATE POLICY|ALTER POLICY/i)
  })

  test('successful ACTIVE state is selected by the unchanged public and digest paths', () => {
    assert.match(publicQueries, /query\.in\('status', \['ACTIVE', 'PROMOTED'\]\)/)
    assert.match(publicQueries, /query = query\.eq\('has_verified_source', true\)/)
    assert.match(digestRoute, /\.in\('status', \['ACTIVE', 'PROMOTED'\]\)/)
    assert.match(digestRoute, /\.gt\('created_at', lastSentAt\)/)
    assert.match(digestRoute, /\.limit\(MAX_SIGNALS_PER_DIGEST\)/)
  })
})
