import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  guardEnrichmentExecution,
  ENRICHMENT_CONTROL_KEY,
} from '../../src/lib/security/enrichment-execution'

// Called ONLY by the real disposable PostgreSQL harness, never a remote DB.
const host = process.env.PGTEST_HOST
const port = process.env.PGTEST_PORT
assert.ok(host && (host === '127.0.0.1' || host.includes('aiscentra-pgtest-')))
assert.ok(port && port !== '5432')
const sql = (query: string): string =>
  execFileSync(
    'psql',
    ['-h', host, '-p', port, '-U', 'postgres', '-tAq', '-v', 'ON_ERROR_STOP=1', '-c', query],
    { encoding: 'utf8' },
  ).trim()
const readState = async (): Promise<boolean | undefined> => {
  const result = sql(
    `select execution_enabled from public.sis_execution_controls where control_key='${ENRICHMENT_CONTROL_KEY}'`,
  )
  return result === 't' ? true : result === 'f' ? false : undefined
}
async function main(): Promise<void> {
  sql(
    `update public.sis_execution_controls set execution_enabled=false where control_key='${ENRICHMENT_CONTROL_KEY}'`,
  )
  const snapshot = (): string =>
    sql(
      `select jsonb_build_object('control', (select jsonb_agg(c) from public.sis_execution_controls c), 'runs', (select count(*) from public.sis_execution_runs), 'attempts', (select count(*) from public.sis_execution_attempts), 'signals', (select count(*) from public.signals), 'decisions', (select count(*) from public.signal_decision_log), 'queue', (select count(*) from pgmq.q_durable_sis_v1))`,
    )
  const before = snapshot()
  assert.equal((await guardEnrichmentExecution(readState))?.status, 200)
  assert.equal(snapshot(), before, 'disabled guard must not mutate real PostgreSQL')
  assert.equal(
    (
      await guardEnrichmentExecution(async () => {
        sql('select execution_enabled from public.missing_control_table')
      })
    )?.status,
    503,
  )
  assert.equal(snapshot(), before, 'read failure must not mutate real PostgreSQL')
  sql(
    `update public.sis_execution_controls set execution_enabled=true where control_key='${ENRICHMENT_CONTROL_KEY}'`,
  )
  try {
    assert.equal(await guardEnrichmentExecution(readState), null)
  } finally {
    sql(
      `update public.sis_execution_controls set execution_enabled=false where control_key='${ENRICHMENT_CONTROL_KEY}'`,
    )
  }
  console.log(
    'PASS: real PostgreSQL enrichment execution guard: false, read error, true, zero side effects',
  )
}
void main()
