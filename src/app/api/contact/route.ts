/**
 * AIscentra — Contact Form API
 *
 * POST /api/contact
 * Body: { name: string, email: string, message: string }
 *
 * Sends a real email via Resend's REST API (no SDK dependency --
 * plain fetch, matching this project's own generic-HTTP-client
 * convention used elsewhere for AI providers). Sent from the site's
 * own real, verified domain (aiscentra.com -- confirmed verified in
 * Resend as of 2026-08-03: domain added, DNS verified, status "ready
 * to send").
 *
 * Strict Zod validation on all three fields before any network call.
 * RESEND_API_KEY is read from env at request time (not at module load)
 * so a missing key fails this one request, not the whole build.
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const ContactSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200),
  email: z.string().trim().email('A valid email is required').max(320),
  message: z.string().trim().min(1, 'Message is required').max(5000),
})

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
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

  const { name, email, message } = parsed.data

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
