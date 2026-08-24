import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const scriptPath = resolve('scripts/repair/requeue-lost-sis-observations-20260823.sql')
const sql = readFileSync(scriptPath, 'utf8')

const expectedIds = new Set([
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

describe('lost SIS observation repair SQL', () => {
  test('targets exactly the nine production-proven IDs and no others', () => {
    const targetBlock = /with repair_targets\(id\) as \((.*?)\), repaired as/is.exec(sql)?.[1]
    assert.ok(targetBlock, 'repair_targets CTE must exist')
    const ids = new Set(
      [...targetBlock.matchAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi)].map(
        ([id]) => id.toLowerCase(),
      ),
    )
    assert.deepEqual(ids, expectedIds)
    assert.equal(ids.size, 9)
  })

  test('is queue-only, guarded, auditable, and idempotent on repeat execution', () => {
    assert.match(sql, /update public\.observations/i)
    assert.doesNotMatch(sql, /\b(delete|truncate|insert)\b/i)
    assert.match(sql, /processed\s*=\s*false/i)
    assert.match(sql, /processing_error\s*=\s*null/i)
    assert.match(sql, /observation\.processed is true/i)
    assert.match(sql, /observation\.signal_id is null/i)
    assert.match(sql, /observation\.rejection_code is null/i)
    assert.match(sql, /processing_error like 'SIS: \[agent:classifier\] All models failed:%'/i)
    assert.match(sql, /metadata->>'repair_key' is distinct from/i)
    assert.match(sql, /repair_audit/i)
    assert.match(sql, /begin;/i)
    assert.match(sql, /commit;/i)
  })
})
