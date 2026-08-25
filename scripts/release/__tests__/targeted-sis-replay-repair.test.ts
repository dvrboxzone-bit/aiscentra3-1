import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const scriptPath = resolve('scripts/repair/requeue-terminalized-targeted-sis-replay-20260824.sql')
const sql = readFileSync(scriptPath, 'utf8')
const v2ScriptPath = resolve(
  'scripts/repair/requeue-de90407c-for-targeted-sis-replay-v2-20260825.sql',
)
const v2Sql = readFileSync(v2ScriptPath, 'utf8')

const expectedIds = new Set([
  'e4275483-39e4-4441-84a2-0a1df546cf07',
  'ec86e548-8394-4c45-8353-7ba588f23cf3',
  'fc22b35a-776b-4666-aabc-64ea1a198c34',
])

describe('targeted SIS replay terminalization repair SQL', () => {
  test('targets exactly the three rows attempted by the failed replay', () => {
    const targetBlock = /with repair_targets\(id\) as \((.*?)\), repaired as/is.exec(sql)?.[1]
    assert.ok(targetBlock, 'repair_targets CTE must exist')
    const ids = new Set(
      [
        ...targetBlock.matchAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi),
      ].map(([id]) => id.toLowerCase()),
    )
    assert.deepEqual(ids, expectedIds)
    assert.equal(ids.size, 3)
  })

  test('is queue-only, guarded, history-preserving, and idempotent', () => {
    assert.match(sql, /update public\.observations/i)
    assert.doesNotMatch(sql, /\b(delete|truncate|insert)\b/i)
    assert.doesNotMatch(sql, /update public\.(signals|signal_decision_log)/i)
    assert.match(sql, /processed\s*=\s*false/i)
    assert.match(sql, /processing_error\s*=\s*null/i)
    assert.match(sql, /observation\.processed is true/i)
    assert.match(sql, /observation\.signal_id is null/i)
    assert.match(sql, /observation\.rejection_code is null/i)
    assert.match(sql, /processing_error like 'SIS: \[agent:classifier\] All models failed:%'/i)
    assert.match(sql, /targeted_sis_replay_history/i)
    assert.match(sql, /terminal_processing_error/i)
    assert.match(sql, /targeted_sis_repair_key'[\s\S]*is distinct from/i)
    assert.match(sql, /begin;/i)
    assert.match(sql, /commit;/i)
  })
})

describe('targeted SIS replay v2 single-observation repair SQL', () => {
  const targetId = 'de90407c-d4b9-4eee-862f-12a549f9544d'

  test('targets only de90407c and guards both eligible and idempotent states', () => {
    const ids = new Set(
      [...v2Sql.matchAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi)].map(
        ([id]) => id.toLowerCase(),
      ),
    )

    assert.deepEqual(ids, new Set([targetId]))
    assert.match(v2Sql, /where observation\.id = 'de90407c[^']+'::uuid/gi)
    assert.match(v2Sql, /observation\.processed is true/i)
    assert.match(v2Sql, /preflight\.processed is false/i)
    assert.match(v2Sql, /targeted_sis_repair_v2_key/i)
    assert.match(v2Sql, /is distinct from 'repair_de90407c_for_targeted_sis_replay_20260825_v2'/i)
  })

  test('has fail-closed preflight/postcheck and changes no Signal or decision row', () => {
    assert.match(v2Sql, /sis_replay_v2_repair_preflight/i)
    assert.match(v2Sql, /sis_replay_v2_repair_result/i)
    assert.match(v2Sql, /Postcheck failed: repair changed more than one observation/i)
    assert.match(v2Sql, /post_signal_count <> preflight\.signal_count/i)
    assert.match(v2Sql, /post_decision_count <> preflight\.decision_count/i)
    assert.match(v2Sql, /update public\.observations/i)
    assert.doesNotMatch(v2Sql, /update public\.(signals|signal_decision_log)/i)
    assert.doesNotMatch(v2Sql, /delete\s+from|truncate\s+/i)
    assert.match(v2Sql, /processed\s*=\s*false/i)
    assert.match(v2Sql, /processing_error\s*=\s*null/i)
    assert.match(v2Sql, /targeted_sis_replay_v2_key' is null/i)
    assert.match(v2Sql, /targeted_sis_replay_key'[\s\S]*is not distinct from/i)
    assert.match(v2Sql, /targeted_sis_replay_audit'[\s\S]*is not distinct from/i)
    assert.match(v2Sql, /begin;/i)
    assert.match(v2Sql, /commit;/i)
  })
})
