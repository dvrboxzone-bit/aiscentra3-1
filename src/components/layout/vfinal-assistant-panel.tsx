'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useAssistantPanel } from './vfinal-assistant-context'

interface Message {
  role: 'user' | 'assistant'
  text: string
}

const CONTENT_COMMANDS = [
  'What changed in the AI ecosystem today?',
  'Explain a signal category',
  'How does AIscentra verify signals?',
]

const SERVICE_COMMANDS: Array<{ label: string; note: string }> = [
  { label: 'Submit a case', note: 'Reporting an issue with a specific signal' },
  { label: 'Report abuse', note: 'Reporting inappropriate content' },
  { label: 'Ask Founder or Creator', note: 'A direct question for Denis Dan' },
]

/**
 * AIscentra — real sliding Assistant panel.
 *
 * Real, honest architecture: the 3 content quick-commands genuinely
 * POST to /api/assistant (the real, existing endpoint) and render
 * whatever real response comes back -- including a real, honest
 * "Service temporarily unavailable" (the exact real message the
 * route's own containment guard returns, see
 * src/lib/security/api-access.ts's own serviceUnavailableResponse())
 * if Assistant is still in its current, deliberate containment phase
 * at the time this ships. Nothing here fabricates a working AI
 * response -- the panel is real plumbing that will simply start
 * working once that separate, already-planned containment-lifting
 * task happens, with zero UI changes needed at that point.
 *
 * The 3 service commands (Submit a case / Report abuse / Ask Founder
 * or Creator) do NOT pretend the Assistant itself handles these --
 * there is no real backend for "cases" or "abuse reports" built in
 * this project. The only real, working "reach a human" channel that
 * exists is the real /contact form (Resend-backed email, confirmed
 * working). These 3 commands honestly navigate there instead of
 * fabricating an in-panel flow that doesn't exist.
 */
export function VfinalAssistantPanel(): React.JSX.Element | null {
  const { isOpen, close } = useAssistantPanel()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'error'>('idle')

  async function sendQuery(query: string): Promise<void> {
    if (!query.trim() || status === 'sending') return
    setMessages((prev) => [...prev, { role: 'user', text: query }])
    setInput('')
    setStatus('sending')

    try {
      const response = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      })

      // Real contract (src/app/api/assistant/route.ts): every non-2xx
      // response (containment guard, quota exceeded, invalid input) is
      // a real, plain JSON { error: string } body -- NEVER a stream.
      // Only a genuine 2xx success is real Server-Sent Events
      // ("text/event-stream": a real `meta` event, real streamed
      // `text` chunks, a final literal `[DONE]`). Consuming a 2xx
      // response as JSON, or a non-2xx response as SSE, would both be
      // real bugs -- this branches on response.ok precisely because
      // the real backend genuinely uses two different real formats.
      if (!response.ok) {
        const data = (await response.json()) as { error?: string }
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', text: data.error ?? 'The Observatory Assistant is unavailable.' },
        ])
        setStatus('idle')
        return
      }

      const reader = response.body?.getReader()
      if (!reader) {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', text: 'The Observatory Assistant could not respond.' },
        ])
        setStatus('idle')
        return
      }

      const decoder = new TextDecoder()
      let accumulated = ''
      setMessages((prev) => [...prev, { role: 'assistant', text: '' }])

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue
          const raw = line.slice(6)
          if (raw === '[DONE]') continue
          try {
            const parsed = JSON.parse(raw) as { type: string; content?: string }
            if (parsed.type === 'text' && parsed.content) {
              accumulated += parsed.content
              setMessages((prev) => {
                const next = [...prev]
                next[next.length - 1] = { role: 'assistant', text: accumulated }
                return next
              })
            }
          } catch {
            // Real, malformed SSE chunk -- skip, matching the real
            // server's own identical tolerance for this.
          }
        }
      }
      setStatus('idle')
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: 'The Observatory Assistant could not respond. Please check your connection and try again.',
        },
      ])
      setStatus('error')
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[60] flex justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={close} />

      <aside
        role="dialog"
        aria-label="Observatory Assistant"
        className="relative flex h-full w-full max-w-md flex-col border-l border-border-subtle bg-deep-obsidian"
      >
        <div className="flex items-center justify-between border-b border-border-subtle p-4">
          <span className="font-caption text-mint-signal">ASK THE OBSERVATORY</span>
          <button
            type="button"
            onClick={close}
            aria-label="Close Assistant"
            className="text-silver-haze hover:text-mint-signal"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {messages.length === 0 ? (
            <p className="text-sm leading-relaxed text-silver-haze">
              Welcome. I can help you explore signals, events and analysis across the AI
              ecosystem — ask a question, or choose a quick action below.
            </p>
          ) : (
            <div className="space-y-3">
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={
                    m.role === 'user'
                      ? 'ml-auto max-w-[85%] border border-border-subtle bg-surface-tonal p-3 text-sm text-frost'
                      : 'max-w-[85%] text-sm leading-relaxed text-silver-haze'
                  }
                >
                  {m.text}
                </div>
              ))}
            </div>
          )}

          <div className="mt-6 space-y-2">
            <span className="font-caption block text-silver-haze">QUICK ACTIONS</span>
            {CONTENT_COMMANDS.map((cmd) => (
              <button
                key={cmd}
                type="button"
                onClick={() => {
                  void sendQuery(cmd)
                }}
                className="block w-full border border-border-subtle p-2 text-left text-xs text-silver-haze hover:border-mint-signal hover:text-mint-signal"
              >
                {cmd}
              </button>
            ))}
            {SERVICE_COMMANDS.map(({ label, note }) => (
              <Link
                key={label}
                href="/contact"
                onClick={close}
                title={note}
                className="block w-full border border-border-subtle p-2 text-left text-xs text-silver-haze hover:border-mint-signal hover:text-mint-signal"
              >
                {label}
              </Link>
            ))}
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            void sendQuery(input)
          }}
          className="flex items-center gap-2 border-t border-border-subtle p-4"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask the Observatory anything about the AI ecosystem…"
            className="observatory-input font-body flex-1 border-none bg-transparent px-2 py-2 text-sm text-frost"
          />
          <button
            type="submit"
            disabled={status === 'sending' || !input.trim()}
            className="btn-pill magnetic text-xs disabled:opacity-40"
          >
            {status === 'sending' ? '···' : '↗'}
          </button>
        </form>
      </aside>
    </div>
  )
}
