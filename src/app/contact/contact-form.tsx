'use client'

import { useState } from 'react'

/**
 * AIscentra — real contact form client component. Real POST to
 * /api/contact, real loading/success/error states (no fabricated
 * "sent" confirmation before the real request actually succeeds).
 * Same real observatory-input/btn-pill classes as the homepage's own
 * Assistant form -- inherits the same real mobile responsiveness
 * (these classes are already used inside a max-w-[640px] container
 * elsewhere on the site, matching this page's own container width).
 */
export function ContactForm(): React.JSX.Element {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState('')

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setStatus('sending')
    setErrorMessage('')

    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, message }),
      })
      const data = (await response.json()) as { ok?: boolean; error?: string }

      if (!response.ok || !data.ok) {
        setErrorMessage(data.error ?? 'The message could not be sent. Please try again.')
        setStatus('error')
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

      {status === 'error' && <p className="font-mono text-xs text-amber-400">{errorMessage}</p>}

      <button
        type="submit"
        disabled={status === 'sending'}
        className="btn-pill magnetic w-full text-xs disabled:opacity-40 sm:w-auto"
      >
        {status === 'sending' ? 'SENDING...' : 'SEND MESSAGE'}
      </button>
    </form>
  )
}
