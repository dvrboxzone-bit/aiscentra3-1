/**
 * AIscentra — Cron: Signals Digest to Subscribers
 *
 * GET /api/cron/signals-digest
 *
 * Sends a real digest email (via Resend's Broadcast API) to everyone
 * subscribed to the "Signals" Topic, containing up to 3 real,
 * publicly-visible Signals (status IN ('ACTIVE','PROMOTED') -- the
 * exact same real filter getSignals() itself already uses for the
 * public /signals catalog, reused here rather than reinvented)
 * created since the last successful send.
 *
 * State is tracked in a new, additive-only table
 * (`signal_digest_state`, single row, id=1) recording only
 * `last_sent_at` -- no existing table is touched. If no new
 * qualifying Signal exists since that timestamp, this run exits
 * honestly without sending anything (no empty/filler digest is ever
 * sent) and without advancing `last_sent_at`.
 *
 * Real Resend Broadcast API contract (fetched directly from Resend's
 * own docs, not guessed): POST https://api.resend.com/broadcasts,
 * required `segment_id` + `topic_id` (topic further scopes sending
 * within that segment to only Signals-subscribed contacts), `send:
 * true` to send immediately rather than leaving a draft.
 * {{{RESEND_UNSUBSCRIBE_URL}}} is Resend's own real broadcast
 * placeholder, auto-replaced per recipient.
 */
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export const maxDuration = 30
export const dynamic = 'force-dynamic'

const MAX_SIGNALS_PER_DIGEST = 3

interface DigestSignal {
  id: string
  title: string
  description: string
  category: string
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function buildDigestHtml(signals: DigestSignal[], appUrl: string): string {
  const items = signals
    .map(
      (s) => `
        <div style="margin-bottom:24px;padding-bottom:24px;border-bottom:1px solid #333;">
          <p style="font-size:11px;letter-spacing:0.08em;color:#8B9D83;text-transform:uppercase;margin:0 0 6px;">${escapeHtml(s.category)}</p>
          <h2 style="font-size:18px;margin:0 0 8px;color:#fff;">${escapeHtml(s.title)}</h2>
          <p style="font-size:14px;color:#ccc;margin:0 0 8px;">${escapeHtml(s.description)}</p>
          <a href="${appUrl}/signals/${s.id}" style="color:#8B9D83;font-size:13px;">Read this Signal →</a>
        </div>`,
    )
    .join('')

  return `
    <div style="background:#030303;color:#e5e7eb;padding:32px;font-family:sans-serif;">
      <p style="font-size:11px;letter-spacing:0.08em;color:#8B9D83;text-transform:uppercase;margin:0 0 24px;">New AIscentra Signals</p>
      ${items}
      <p style="margin-top:24px;">
        <a href="${appUrl}/signals" style="color:#8B9D83;">See all Signals →</a>
      </p>
      <p style="font-size:12px;color:#666;margin-top:32px;">
        Sent to you because you subscribed to AIscentra Signals.
        <a href="{{{RESEND_UNSUBSCRIBE_URL}}}" style="color:#666;">Unsubscribe</a>
        · <a href="${appUrl}/privacy" style="color:#666;">Privacy Policy</a>
      </p>
    </div>`
}

export async function GET(request: Request): Promise<NextResponse> {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env['CRON_SECRET']}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const apiKey = process.env['RESEND_API_KEY']
  const segmentId = process.env['RESEND_SEGMENT_ALL_SUBSCRIBERS_ID']
  const topicId = process.env['RESEND_TOPIC_SIGNALS_ID']
  const appUrl = process.env['NEXT_PUBLIC_APP_URL'] ?? 'https://aiscentra.com'

  if (!apiKey || !segmentId || !topicId) {
    console.error(
      '[cron/signals-digest] Missing required env var(s): RESEND_API_KEY / RESEND_SEGMENT_ALL_SUBSCRIBERS_ID / RESEND_TOPIC_SIGNALS_ID',
    )
    return NextResponse.json({ ok: false, reason: 'not_configured' }, { status: 503 })
  }

  const supabase = createAdminClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: stateRow, error: stateError } = await (supabase as any)
    .from('signal_digest_state')
    .select('last_sent_at')
    .eq('id', 1)
    .maybeSingle()

  if (stateError) {
    console.error('[cron/signals-digest] Failed to read digest state:', stateError.message)
    return NextResponse.json({ ok: false, reason: 'state_read_failed' }, { status: 500 })
  }

  const lastSentAt: string = stateRow?.last_sent_at ?? new Date(0).toISOString()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: signals, error: signalsError } = await (supabase as any)
    .from('signals')
    .select('id, title, description, category, created_at')
    .in('status', ['ACTIVE', 'PROMOTED'])
    .gt('created_at', lastSentAt)
    .order('created_at', { ascending: true })
    .limit(MAX_SIGNALS_PER_DIGEST)

  if (signalsError) {
    console.error('[cron/signals-digest] Failed to query signals:', signalsError.message)
    return NextResponse.json({ ok: false, reason: 'signals_query_failed' }, { status: 500 })
  }

  if (!signals || signals.length === 0) {
    return NextResponse.json({ ok: true, sent: false, reason: 'no_new_signals' })
  }

  const digestSignals = signals as Array<DigestSignal & { created_at: string }>
  const html = buildDigestHtml(digestSignals, appUrl)
  const lastSignal = digestSignals[digestSignals.length - 1]
  if (!lastSignal) {
    // Unreachable given the length check above, but satisfies strict
    // null-checking without a forbidden non-null assertion.
    return NextResponse.json({ ok: false, reason: 'unexpected_empty_digest' }, { status: 500 })
  }
  const newestCreatedAt = lastSignal.created_at

  try {
    const response = await fetch('https://api.resend.com/broadcasts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        segment_id: segmentId,
        topic_id: topicId,
        from: 'AIscentra Signals <signals@aiscentra.com>',
        subject: `${signals.length} new AIscentra Signal${signals.length > 1 ? 's' : ''}`,
        html,
        send: true,
      }),
    })

    if (!response.ok) {
      const detail = await response.text()
      console.error('[cron/signals-digest] Resend Broadcast API error:', response.status, detail)
      return NextResponse.json({ ok: false, reason: 'resend_broadcast_failed' }, { status: 502 })
    }
  } catch (error) {
    console.error('[cron/signals-digest] Unexpected error sending broadcast:', error)
    return NextResponse.json({ ok: false, reason: 'unexpected_error' }, { status: 502 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: upsertError } = await (supabase as any)
    .from('signal_digest_state')
    .upsert({ id: 1, last_sent_at: newestCreatedAt })

  if (upsertError) {
    // Real, honest failure mode: the email was already sent
    // successfully above, but the state update failed -- the NEXT run
    // would re-send the same Signals. Logged loudly so this is
    // actually noticed and fixed, not silently repeated forever.
    console.error(
      '[cron/signals-digest] CRITICAL: broadcast sent but state update failed -- next run will resend the same Signals:',
      upsertError.message,
    )
    return NextResponse.json(
      { ok: true, sent: true, stateUpdateFailed: true, signalCount: signals.length },
      { status: 200 },
    )
  }

  return NextResponse.json({ ok: true, sent: true, signalCount: signals.length })
}
