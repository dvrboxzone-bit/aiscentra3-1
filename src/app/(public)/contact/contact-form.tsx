'use client'

import { useEffect, useRef, useState } from 'react'

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: {
          sitekey: string
          callback: (token: string) => void
          'error-callback'?: () => void
          'expired-callback'?: () => void
        },
      ) => string
      reset: (widgetId: string) => void
    }
  }
}

const TURNSTILE_SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js'

/**
 * AIscentra — real contact form client component. Real POST to
 * /api/contact, real loading/success/error states (no fabricated
 * "sent" confirmation before the real request actually succeeds).
 * Same real observatory-input/btn-pill classes as the homepage's own
 * Assistant form -- inherits the same real mobile responsiveness
 * (these classes are already used inside a max-w-[640px] container
 * elsewhere on the site, matching this page's own container width).
 *
 * Cloudflare Turnstile, real bot-verification widget: loaded via the
 * official script tag (no npm package added -- matches this
 * project's own established convention of plain fetch/DOM over new
 * dependencies, already used for Resend). Explicit render (not
 * implicit cf-turnstile-class scanning) so the widget mounts only
 * once this component itself mounts, not on every page that happens
 * to load the script. The real token is sent to the server alongside
 * the form fields; the server -- not this component -- is the real
 * trust boundary (see /api/contact's own siteverify call). If
 * NEXT_PUBLIC_TURNSTILE_SITE_KEY is genuinely unset, the widget is
 * skipped entirely rather than rendering a broken one -- the server
 * route makes the same real decision independently (see its own
 * docstring), so this is a graceful, honest degradation, not a
 * bypass.
 */
export function ContactForm(): React.JSX.Element {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const turnstileContainerRef = useRef<HTMLDivElement>(null)
  const widgetIdRef = useRef<string | null>(null)

  const siteKey = process.env['NEXT_PUBLIC_TURNSTILE_SITE_KEY']

  useEffect(() => {
    if (!siteKey || !turnstileContainerRef.current) return

    function renderWidget(): void {
      if (!window.turnstile || !turnstileContainerRef.current || widgetIdRef.current) return
      widgetIdRef.current = window.turnstile.render(turnstileContainerRef.current, {
        sitekey: siteKey ?? '',
        callback: (token) => setTurnstileToken(token),
        'error-callback': () => setTurnstileToken(null),
        'expired-callback': () => setTurnstileToken(null),
      })
    }

    if (window.turnstile) {
      renderWidget()
      return
    }

    const existingScript = document.querySelector(`script[src="${TURNSTILE_SCRIPT_SRC}"]`)
    if (existingScript) {
      existingScript.addEventListener('load', renderWidget)
      return () => existingScript.removeEventListener('load', renderWidget)
    }

    const script = document.createElement('script')
    script.src = TURNSTILE_SCRIPT_SRC
    script.async = true
    script.defer = true
    script.addEventListener('load', renderWidget)
    document.head.appendChild(script)
    return () => script.removeEventListener('load', renderWidget)
  }, [siteKey])

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setStatus('sending')
    setErrorMessage('')

    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, message, turnstileToken }),
      })
      const data = (await response.json()) as { ok?: boolean; error?: string }

      if (!response.ok || !data.ok) {
        setErrorMessage(data.error ?? 'The message could not be sent. Please try again.')
        setStatus('error')
        if (widgetIdRef.current && window.turnstile) {
          window.turnstile.reset(widgetIdRef.current)
          setTurnstileToken(null)
        }
        return
      }

      setStatus('sent')
      setName('')
      setEmail('')
      setMessage('')
    } catch {
      setErrorMessage('The message could not be sent. Please check your connection and try again.')
      setStatus('error')
    }
  }

  if (status === 'sent') {
    return (
      <div className="border border-border-subtle bg-surface-tonal p-6 text-center">
        <span className="font-caption mb-2 block text-mint-signal">MESSAGE SENT</span>
        <p className="text-silver-haze">Thank you — your message has been sent.</p>
      </div>
    )
  }

  return (
    <form
      onSubmit={(e) => {
        void handleSubmit(e)
      }}
      className="space-y-4"
    >
      <div>
        <label htmlFor="contact-name" className="font-caption mb-1 block text-silver-haze">
          NAME
        </label>
        <input
          id="contact-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="observatory-input font-body w-full border border-border-subtle bg-surface-tonal px-4 py-2.5 text-frost placeholder-silver-haze"
        />
      </div>

      <div>
        <label htmlFor="contact-email" className="font-caption mb-1 block text-silver-haze">
          EMAIL
        </label>
        <input
          id="contact-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="observatory-input font-body w-full border border-border-subtle bg-surface-tonal px-4 py-2.5 text-frost placeholder-silver-haze"
        />
      </div>

      <div>
        <label htmlFor="contact-message" className="font-caption mb-1 block text-silver-haze">
          MESSAGE
        </label>
        <textarea
          id="contact-message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          required
          rows={6}
          className="observatory-input font-body w-full resize-y border border-border-subtle bg-surface-tonal px-4 py-2.5 text-frost placeholder-silver-haze"
        />
      </div>

      {siteKey && <div ref={turnstileContainerRef} />}

      {status === 'error' && <p className="font-mono text-xs text-amber-400">{errorMessage}</p>}

      <button
        type="submit"
        disabled={status === 'sending' || (Boolean(siteKey) && !turnstileToken)}
        className="btn-pill magnetic w-full text-xs disabled:opacity-40 sm:w-auto"
      >
        {status === 'sending' ? 'SENDING...' : 'SEND MESSAGE'}
      </button>
    </form>
  )
}
