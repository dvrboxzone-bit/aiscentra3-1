/**
 * AIscentra — Contact Form API
 *
 * POST /api/contact
 * Body: { name: string, email: string, message: string, turnstileToken: string | null }
 *
 * Sends a real email via Resend's REST API (no SDK dependency --
 * plain fetch, matching this project's own generic-HTTP-client
 * convention used elsewhere for AI providers). Sent from the site's
 * own real, verified domain (aiscentra.com -- confirmed verified in
 * Resend as of 2026-08-03: domain added, DNS verified, status "ready
 * to send").
 *
 * Cloudflare Turnstile: the REAL trust boundary is here, not the
 * client widget -- a client-side check alone can always be bypassed
 * by a direct POST to this route, so the token is independently
 * re-verified against Cloudflare's own siteverify API
 * (https://challenges.cloudflare.com/turnstile/v0/siteverify) before
 * any email is sent. If TURNSTILE_SECRET_KEY is genuinely unset (not
 * yet configured), Turnstile enforcement is skipped entirely rather
 * than either fabricating a pass or hard-failing every submission --
 * matches the client's own graceful degradation (see contact-form.tsx's
 * docstring) so the form remains usable while Turnstile is being
 * rolled out, without ever silently pretending a real check happened
 * when it didn't.
 *
 * Strict Zod validation on all form fields before any network call.
 * Both RESEND_API_KEY and TURNSTILE_SECRET_KEY are read from env at
 * request time (not at module load) so a missing key fails this one
 * request, not the whole build.
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const ContactSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200),
  email: z.string().trim().email('A valid email is required').max(320),
  message: z.string().trim().min(1, 'Message is required').max(5000),
  turnstileToken: z.string().nullable(),
})

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

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
    console.error('[api/contact] Turnstile siteverify request failed:', error)
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

  const parsed = ContactSchema.safeParse(body)
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0]
    return NextResponse.json({ error: firstIssue?.message ?? 'Invalid input.' }, { status: 400 })
  }

  const { name, email, message, turnstileToken } = parsed.data

  const turnstileSecret = process.env['TURNSTILE_SECRET_KEY']
  if (turnstileSecret) {
    if (!turnstileToken) {
      return NextResponse.json(
        { error: 'Please complete the verification check before sending.' },
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
    console.error('[api/contact] RESEND_API_KEY is not set')
    return NextResponse.json(
      {
        error:
          'The contact form is temporarily unavailable. Please email aiscentra@gmail.com directly.',
      },
      { status: 503 },
    )
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'AIscentra Contact Form <contact@aiscentra.com>',
        to: 'aiscentra@gmail.com',
        reply_to: email,
        subject: `New contact form message from ${name}`,
        html: `<p><strong>From:</strong> ${escapeHtml(name)} (${escapeHtml(email)})</p><p><strong>Message:</strong></p><p>${escapeHtml(message).replaceAll('\n', '<br>')}</p>`,
      }),
    })

    if (!response.ok) {
      const detail = await response.text()
      console.error('[api/contact] Resend API error:', response.status, detail)
      return NextResponse.json(
        {
          error:
            'The message could not be sent. Please try again or email aiscentra@gmail.com directly.',
        },
        { status: 502 },
      )
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[api/contact] Unexpected error sending email:', error)
    return NextResponse.json(
      {
        error:
          'The message could not be sent. Please try again or email aiscentra@gmail.com directly.',
      },
      { status: 502 },
    )
  }
}
