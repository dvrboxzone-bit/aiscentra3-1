'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAssistantPanel } from './vfinal-assistant-context'
import { getActiveLenisInstance } from './vfinal-lenis-provider'

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
 * AIscentra — real, honest label for "which page is the visitor on"
 * (Task 7, explicit owner instruction: "ассистент должен знать на
 * какой странице он находится а пользователь чтобы видеть о чем
 * спрашивает"). Deliberately just formats the real pathname itself
 * rather than maintaining a separate, easily-stale page-name registry
 * -- /signals/some-real-slug shows exactly that, not a guessed title.
 */
function describeCurrentPage(pathname: string): string {
  if (pathname === '/') return 'Home'
  const segments = pathname.split('/').filter(Boolean)
  return segments.map((s) => s.replace(/-/g, ' ')).join(' / ')
}

/**
 * AIscentra — real sliding Assistant panel.
 *
 * Visual correction (independent-review, explicit owner instruction,
 * 2026-08-23): the panel used to conditionally render (`if (!isOpen)
 * return null`), which meant it had NO real transition at all --
 * it simply popped into existence at its final position, clashing
 * with the rest of the site's own smooth Lenis-based motion language.
 * Now always mounted; open/close is a real CSS transform+visibility
 * transition (.assistant-panel/.assistant-panel-overlay in
 * globals.css), the exact same established pattern already used for
 * the mobile off-canvas menu (.mobile-menu-panel) -- both entry and
 * exit are now genuinely smooth, not merely the entry.
 *
 * Background correction: the panel body (excluding the header bar and
 * the input form, both kept solid per explicit owner instruction) now
 * uses the site's own real textured-bg + tech-grid pattern, the same
 * one used throughout the rest of the site for its large content
 * blocks -- not a new visual language, reused verbatim.
 *
 * Logo correction: the real AIscentra logo symbol (VfinalLogoSymbol's
 * #aiscentra-logo, already used identically in the header/footer) now
 * renders centered above the welcome text, sized larger (56x56) than
 * the header's own 48x48 use so it reads clearly as a focal point in
 * this narrower panel, not a fabricated new icon.
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
  const pathname = usePathname()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'error'>('idle')

  // REAL BUG FIXED (owner-reported: scrolling inside the panel's own
  // message area instead scrolled the whole page, hiding bottom
  // content). Root cause: without this, a scroll gesture that reaches
  // the panel's own scroll boundary "chains" onward to the page body.
  // overscroll-behavior: contain (added to the scrollable div itself)
  // is the primary fix; this body-level lock is a second, real layer
  // -- while the panel is open, the page itself cannot scroll at all,
  // so every scroll gesture is unambiguously the panel's own content.
  // REAL FIX (matches the exact same already-proven pattern used by
  // VfinalHeader's own mobile menu for this identical problem --
  // getActiveLenisInstance()?.stop()/.start() -- rather than relying
  // solely on Lenis's own `prevent` option, which real live testing
  // did not conclusively confirm as sufficient on its own. Fully
  // stopping Lenis while the panel is open guarantees it cannot
  // intercept any wheel event anywhere on the page, leaving native
  // overflow-y:auto scrolling on the panel's own message area
  // completely unobstructed.
  useEffect(() => {
    if (!isOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    getActiveLenisInstance()?.stop()
    return () => {
      document.body.style.overflow = previousOverflow
      getActiveLenisInstance()?.start()
    }
  }, [isOpen])

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

  return (
    <div
      className={`assistant-panel-overlay fixed inset-0 flex justify-end ${isOpen ? 'open' : ''}`}
    >
      <aside
        id="assistant-panel"
        role="dialog"
        aria-label="Observatory Assistant"
        className={`assistant-panel relative flex flex-col ${isOpen ? 'open' : ''}`}
      >
        <div className="flex items-center justify-between border-b border-border-subtle p-4">
          <span className="font-caption text-mint-signal">ASK THE OBSERVATORY</span>
          <button
            type="button"
            onClick={close}
            aria-label="Close Assistant"
            className="text-silver-haze hover:text-mint-signal"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect
                x="3"
                y="4"
                width="18"
                height="16"
                rx="2"
                stroke="currentColor"
                strokeWidth="2"
              />
              <line x1="15" y1="4" x2="15" y2="20" stroke="currentColor" strokeWidth="2" />
            </svg>
          </button>
        </div>

        {pathname && (
          <div className="border-b border-border-subtle px-4 py-2">
            <span className="font-caption text-xs text-silver-haze opacity-60">
              Current page: {describeCurrentPage(pathname)}
            </span>
          </div>
        )}

        <div
          className="textured-bg relative min-h-0 flex-1 overflow-y-auto p-4"
          style={{ overscrollBehavior: 'contain' }}
        >
          <div className="tech-grid" />
          <div className="relative z-10">
            {messages.length === 0 ? (
              <>
                <svg width="140" height="56" className="mx-auto mb-6 block">
                  <use href="#aiscentra-logo" />
                </svg>
                <p className="text-sm leading-relaxed text-silver-haze">
                  Welcome. I can help you explore signals, events and analysis across the AI
                  ecosystem — ask a question, or choose a quick action below.
                </p>
              </>
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
                  className="block w-full border border-border-subtle bg-deep-obsidian/60 p-2 text-left text-xs text-silver-haze hover:border-mint-signal hover:text-mint-signal"
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
                  className="block w-full border border-border-subtle bg-deep-obsidian/60 p-2 text-left text-xs text-silver-haze hover:border-mint-signal hover:text-mint-signal"
                >
                  {label}
                </Link>
              ))}
              <div className="block w-full border border-border-subtle bg-deep-obsidian/60 p-2 text-left text-xs text-silver-haze">
                You can ask a question about the content of this page
              </div>
            </div>
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            void sendQuery(input)
          }}
          className="flex items-center gap-2 border-t border-border-subtle bg-deep-obsidian p-4"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask the Observatory anything about the AI ecosystem…"
            className="observatory-input font-body flex-1 rounded-md border border-border-subtle bg-surface-tonal px-3 py-2 text-sm text-frost"
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
