/**
 * AIscentra — Subscribe Form API
 *
 * POST /api/subscribe
 * Body: { email: string, signals: boolean, forecasts: boolean, projectNews: boolean, turnstileToken: string | null }
 *
 * Creates/updates a real Resend Contact via the official Contacts API
 * (POST https://api.resend.com/contacts), opting the contact into
 * whichever of the 3 real Resend Topics were checked on the form.
 * Real, confirmed API contract (fetched directly from Resend's own
 * docs, not guessed): `topics` is an array of
 * { id: string, subscription: 'opt_in' | 'opt_out' }.
 *
 * The 3 real Topic IDs (already created in the Resend dashboard --
 * Signals/Forecasts/Project News) are read from environment
 * variables, not hardcoded, matching the existing project convention
 * for RESEND_API_KEY/TURNSTILE_SECRET_KEY. If a given Topic's env var
 * is genuinely unset, that one topic is silently omitted from the
 * `topics` array rather than failing the whole request -- an honest
 * partial-rollout state, not a silent full failure.
 *
 * Also adds the contact to the real "All Subscribers" Segment
 * (RESEND_SEGMENT_ALL_SUBSCRIBERS_ID) -- Resend's Broadcast API
 * requires a segment_id, Topics alone only filter within one.
 *
 * Cloudflare Turnstile: identical real trust-boundary pattern already
 * established in /api/contact -- re-verified server-side via
 * Cloudflare's own siteverify API before any Resend call is made.
 *
 * Strict Zod validation on all fields before any network call. All
 * secrets read from env at request time, not module load.
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const SubscribeSchema = z.object({
  email: z.string().trim().email('A valid email is required').max(320),
  signals: z.boolean(),
  forecasts: z.boolean(),
  projectNews: z.boolean(),
  turnstileToken: z.string().nullable(),
})

interface TurnstileVerifyResponse {
  success: boolean
  'error-codes'?: string[]
}

async function verifyTurnstileToken(token: string, secretKey: string): Promise<boolean> {
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: secretKey, response: token }),
    })
    const data = (await response.json()) as TurnstileVerifyResponse
    return data.success === true
  } catch (error) {
    console.error('[api/subscribe] Turnstile siteverify request failed:', error)
    return false
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const parsed = SubscribeSchema.safeParse(body)
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0]
    return NextResponse.json({ error: firstIssue?.message ?? 'Invalid input.' }, { status: 400 })
  }

  const { email, signals, forecasts, projectNews, turnstileToken } = parsed.data

  if (!signals && !forecasts && !projectNews) {
    return NextResponse.json(
      { error: 'Please select at least one list to subscribe to.' },
      { status: 400 },
    )
  }

  const turnstileSecret = process.env['TURNSTILE_SECRET_KEY']
  if (turnstileSecret) {
    if (!turnstileToken) {
      return NextResponse.json(
        { error: 'Please complete the verification check before subscribing.' },
        { status: 400 },
      )
    }
    const isHuman = await verifyTurnstileToken(turnstileToken, turnstileSecret)
    if (!isHuman) {
      return NextResponse.json({ error: 'Verification failed. Please try again.' }, { status: 400 })
    }
  }

  const apiKey = process.env['RESEND_API_KEY']
  if (!apiKey) {
    console.error('[api/subscribe] RESEND_API_KEY is not set')
    return NextResponse.json(
      { error: 'The subscribe form is temporarily unavailable. Please try again later.' },
      { status: 503 },
    )
  }

  const topicSelections: Array<{ id: string; subscription: 'opt_in' | 'opt_out' }> = []
  const signalsTopicId = process.env['RESEND_TOPIC_SIGNALS_ID']
  const forecastsTopicId = process.env['RESEND_TOPIC_FORECASTS_ID']
  const projectNewsTopicId = process.env['RESEND_TOPIC_PROJECT_NEWS_ID']

  if (signalsTopicId) {
    topicSelections.push({ id: signalsTopicId, subscription: signals ? 'opt_in' : 'opt_out' })
  }
  if (forecastsTopicId) {
    topicSelections.push({ id: forecastsTopicId, subscription: forecasts ? 'opt_in' : 'opt_out' })
  }
  if (projectNewsTopicId) {
    topicSelections.push({
      id: projectNewsTopicId,
      subscription: projectNews ? 'opt_in' : 'opt_out',
    })
  }

  try {
    const response = await fetch('https://api.resend.com/contacts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        unsubscribed: false,
        topics: topicSelections,
      }),
    })

    if (!response.ok) {
      const detail = await response.text()
      console.error('[api/subscribe] Resend API error:', response.status, detail)
      return NextResponse.json(
        { error: 'The subscription could not be saved. Please try again later.' },
        { status: 502 },
      )
    }

    // REAL BUG FIXED (found via direct research of Resend's own
    // Broadcast API docs, before writing the send logic): Resend's
    // Broadcasts API requires a `segment_id` (required parameter) --
    // `topic_id` alone only further FILTERS within a segment, it does
    // not replace one. Contacts created via the Contacts API are NOT
    // automatically placed in any segment. Without this second real
    // call, a subscriber would never actually receive a Broadcast no
    // matter which Topics they opted into.
    const segmentId = process.env['RESEND_SEGMENT_ALL_SUBSCRIBERS_ID']
    if (segmentId) {
      const segmentResponse = await fetch(
        `https://api.resend.com/contacts/${encodeURIComponent(email)}/segments/${segmentId}`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}` },
        },
      )
      if (!segmentResponse.ok) {
        const detail = await segmentResponse.text()
        console.error(
          '[api/subscribe] Failed to add contact to segment:',
          segmentResponse.status,
          detail,
        )
        // Not a hard failure: the Contact and its Topic preferences
        // were already saved successfully above. Being outside the
        // Segment only means the next digest send won't reach them
        // yet -- logged for investigation, not surfaced as an error
        // to the person who just subscribed.
      }
    } else {
      console.error(
        '[api/subscribe] RESEND_SEGMENT_ALL_SUBSCRIBERS_ID is not set -- contact saved but not added to any segment',
      )
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[api/subscribe] Unexpected error saving subscription:', error)
    return NextResponse.json(
      { error: 'The subscription could not be saved. Please try again later.' },
      { status: 502 },
    )
  }
}
