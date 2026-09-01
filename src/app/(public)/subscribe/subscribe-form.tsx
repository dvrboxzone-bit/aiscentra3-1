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
 * AIscentra — real subscribe form client component. Real POST to
 * /api/subscribe, real loading/success/error states. Same Cloudflare
 * Turnstile pattern already established and proven in contact-form.tsx
 * -- identical script-loading/render/reset logic, reused verbatim, not
 * reinvented.
 *
 * Three real checkboxes matching the 3 real Resend Topics already
 * created (Signals/Forecasts/Project News). Signals defaults checked
 * (the site's own primary offering, matching that Topic's own real
 * Opt-in default in Resend); Forecasts and Project News default
 * unchecked (matching their own real Opt-out default) -- per the real
 * GDPR guidance already researched this session: pre-ticking is only
 * acceptable for a form's own single, unambiguous primary purpose, not
 * for additional, separable purposes.
 */
export function SubscribeForm(): React.JSX.Element {
  const [email, setEmail] = useState('')
  const [signals, setSignals] = useState(true)
  const [forecasts, setForecasts] = useState(false)
  const [projectNews, setProjectNews] = useState(false)
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
    if (!signals && !forecasts && !projectNews) {
      setErrorMessage('Please select at least one list to subscribe to.')
      setStatus('error')
      return
    }
    setStatus('sending')
    setErrorMessage('')

    try {
      const response = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, signals, forecasts, projectNews, turnstileToken }),
      })
      const data = (await response.json()) as { ok?: boolean; error?: string }

      if (!response.ok || !data.ok) {
        setErrorMessage(data.error ?? 'The subscription could not be saved. Please try again.')
        setStatus('error')
        if (widgetIdRef.current && window.turnstile) {
          window.turnstile.reset(widgetIdRef.current)
          setTurnstileToken(null)
        }
        return
      }

      setStatus('sent')
      setEmail('')
    } catch {
      setErrorMessage(
        'The subscription could not be saved. Please check your connection and try again.',
      )
      setStatus('error')
    }
  }

  if (status === 'sent') {
    return (
      <div className="border border-border-subtle bg-surface-tonal p-6 text-center">
        <span className="font-caption mb-2 block text-mint-signal">SUBSCRIBED</span>
        <p className="text-silver-haze">
          Thank you — your subscription has been saved. You can unsubscribe at any time from any
          email you receive.
        </p>
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
        <label htmlFor="subscribe-email" className="font-caption mb-1 block text-silver-haze">
          EMAIL
        </label>
        <input
          id="subscribe-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="observatory-input font-body w-full border border-border-subtle bg-surface-tonal px-4 py-2.5 text-frost placeholder-silver-haze"
        />
      </div>

      <label className="flex items-start gap-3 border border-border-subtle bg-surface-tonal p-4">
        <input
          type="checkbox"
          checked={signals}
          onChange={(e) => setSignals(e.target.checked)}
          className="mt-1"
        />
        <span>
          <span className="block text-sm font-medium text-frost">Signals</span>
          <span className="block text-xs text-silver-haze">
            New Signals across all categories, up to 3 per email.
          </span>
        </span>
      </label>

      <label className="flex items-start gap-3 border border-border-subtle bg-surface-tonal p-4">
        <input
          type="checkbox"
          checked={forecasts}
          onChange={(e) => setForecasts(e.target.checked)}
          className="mt-1"
        />
        <span>
          <span className="block text-sm font-medium text-frost">Forecasts</span>
          <span className="block text-xs text-silver-haze">
            Sent as soon as a new forecast is published.
          </span>
        </span>
      </label>

      <label className="flex items-start gap-3 border border-border-subtle bg-surface-tonal p-4">
        <input
          type="checkbox"
          checked={projectNews}
          onChange={(e) => setProjectNews(e.target.checked)}
          className="mt-1"
        />
        <span>
          <span className="block text-sm font-medium text-frost">Project news</span>
          <span className="block text-xs text-silver-haze">
            Occasional updates about AIscentra itself, not Signals.
          </span>
        </span>
      </label>

      {siteKey && <div ref={turnstileContainerRef} />}

      {status === 'error' && <p className="font-mono text-xs text-amber-400">{errorMessage}</p>}

      <button
        type="submit"
        disabled={status === 'sending' || (Boolean(siteKey) && !turnstileToken)}
        className="btn-pill magnetic w-full text-xs disabled:opacity-40 sm:w-auto"
      >
        {status === 'sending' ? 'SUBSCRIBING...' : 'SUBSCRIBE'}
      </button>

      <p className="text-xs text-silver-haze">
        By subscribing, you agree to our{' '}
        <a href="/privacy" className="text-mint-signal hover:underline">
          Privacy Policy
        </a>
        . You can unsubscribe at any time, with one click, from any email you receive.
      </p>
    </form>
  )
}
