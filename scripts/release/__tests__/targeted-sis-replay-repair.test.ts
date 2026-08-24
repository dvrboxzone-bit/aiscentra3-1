import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const scriptPath = resolve('scripts/repair/requeue-terminalized-targeted-sis-replay-20260824.sql')
const sql = readFileSync(scriptPath, 'utf8')

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
