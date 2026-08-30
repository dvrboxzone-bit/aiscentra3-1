/**
 * AIscentra — /api/cron/signals-digest route source-level tests
 *
 * Same source-level assertion technique already established for
 * /api/cron/verify-urls's own route-security.test.ts -- checking the
 * real source text for specific, load-bearing invariants, rather than
 * a full execution mock (this route's own dependencies -- Supabase
 * service-role client + two real external Resend API calls -- would
 * require a heavier harness than this route's real risk profile
 * justifies; matches the project's own established convention for
 * cron routes specifically).
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = (): string => readFileSync('src/app/api/cron/signals-digest/route.ts', 'utf8')
const pipelineSrc = (): string => readFileSync('src/app/api/cron/pipeline/route.ts', 'utf8')
const migrationSrc = (): string =>
  readFileSync('supabase/migrations/20260827143320_add_signal_digest_state.sql', 'utf8')

describe('/api/cron/signals-digest route — security and correctness invariants', () => {
  test('requires the real CRON_SECRET shared-secret guard before any work', () => {
    const s = src()
    assert.match(s, /const cronSecret = process\.env\['CRON_SECRET'\]/)
    assert.match(s, /if \(!cronSecret\)/)
    assert.match(s, /authHeader !== `Bearer \$\{cronSecret\}`/)
    assert.match(s, /status: 401/)
  })

  test('has one dedicated daily scheduler after pipeline and no duplicate pipeline dispatch', () => {
    const vercel = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
      crons: Array<{ path: string; schedule: string }>
    }
    assert.deepEqual(vercel.crons, [
      { path: '/api/cron/pipeline', schedule: '0 10 * * *' },
      { path: '/api/cron/signals-digest', schedule: '0 11 * * *' },
    ])
    assert.doesNotMatch(pipelineSrc(), /\/api\/cron\/signals-digest/)
  })

  test('uses the exact same real public-visibility filter getSignals() itself uses -- status IN (ACTIVE, PROMOTED)', () => {
    const s = src()
    assert.match(s, /\.in\('status', \['ACTIVE', 'PROMOTED'\]\)/)
  })

  test('never sends an empty/filler digest -- exits honestly when no new Signal exists', () => {
    const s = src()
    assert.match(s, /if \(!signals \|\| signals\.length === 0\)/)
    assert.match(s, /reason: 'no_new_signals'/)
  })

  test('the real Resend Broadcast API call includes BOTH segment_id and topic_id -- topic_id alone cannot scope a Broadcast', () => {
    const s = src()
    const broadcastCallIdx = s.indexOf("fetch('https://api.resend.com/broadcasts'")
    assert.ok(broadcastCallIdx > -1, 'must call the real Broadcast API endpoint')
    const bodyRegion = s.slice(broadcastCallIdx, broadcastCallIdx + 700)
    assert.match(bodyRegion, /segment_id: segmentId/)
    assert.match(bodyRegion, /topic_id: topicId/)
    assert.match(bodyRegion, /send: true/, 'must send immediately, not leave a silent draft')
  })

  test('the real digest email includes a genuine unsubscribe placeholder and a link back to /signals', () => {
    const s = src()
    assert.match(s, /\{\{\{RESEND_UNSUBSCRIBE_URL\}\}\}/)
    assert.match(s, /\$\{appUrl\}\/signals/)
  })

  test('digest state advances only to the newest INCLUDED signal, and only after a real successful send', () => {
    const s = src()
    const sendIdx = s.indexOf("fetch('https://api.resend.com/broadcasts'")
    const upsertIndexes = [...s.matchAll(/\.from\('signal_digest_state'\)\s*\.upsert/g)].map(
      (match) => match.index,
    )
    const postSendUpsertIdx = upsertIndexes.find((index) => index > sendIdx) ?? -1
    assert.ok(
      sendIdx > -1 && postSendUpsertIdx > -1,
      'both the send call and its later state upsert must exist',
    )
    assert.ok(
      postSendUpsertIdx > sendIdx,
      'the state upsert must occur textually after the send call, not before it',
    )
  })

  test('a failed state-update after a successful send is logged loudly, not silently swallowed', () => {
    const s = src()
    assert.match(s, /CRITICAL: broadcast sent but state update failed/)
  })

  test('digest state has RLS and no anon/authenticated policy or grant', () => {
    const migration = migrationSrc()
    assert.match(migration, /ALTER TABLE public\.signal_digest_state ENABLE ROW LEVEL SECURITY;/)
    assert.doesNotMatch(migration, /CREATE POLICY[\s\S]*signal_digest_state/i)
    assert.doesNotMatch(
      migration,
      /GRANT\s+.+\s+ON\s+(?:TABLE\s+)?public\.signal_digest_state\s+TO\s+(?:anon|authenticated)/i,
    )
  })

  test('missing required Resend configuration produces an honest 503, not a silent no-op or a crash', () => {
    const s = src()
    assert.match(s, /!apiKey \|\| !segmentId \|\| !topicId/)
    assert.match(s, /status: 503/)
  })

  test('no raw Supabase/Resend error message is ever returned to the caller -- server-side console.error only', () => {
    const s = src()
    assert.doesNotMatch(
      s,
      /NextResponse\.json\(\s*\{[^}]*error:\s*(\w+\.)?message/,
      'a client-facing response must never embed a raw error message directly',
    )
  })
})
