'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Pulse } from '@/components/ui/pulse'
import { cn } from '@/lib/utils/cn'

interface Message {
  id:      string
  role:    'user' | 'assistant'
  content: string
  context?: { signals: number; events: number; reports: number }
  loading?: boolean
}

const EXAMPLE_QUERIES = [
  'What are the most significant AI model releases recently?',
  'What regulatory developments should I be tracking?',
  'Which companies have shown the most signal activity?',
  'What open source releases are gaining momentum?',
]

export function ObservatoryChat(): React.JSX.Element {
  const [messages,  setMessages]  = useState<Message[]>([])
  const [input,     setInput]     = useState('')
  const [streaming, setStreaming] = useState(false)
  const bottomRef   = useRef<HTMLDivElement>(null)
  const inputRef    = useRef<HTMLTextAreaElement>(null)

  // Auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || streaming) return

    const userMsg: Message = {
      id:      crypto.randomUUID(),
      role:    'user',
      content: text.trim(),
    }

    const assistantMsg: Message = {
      id:      crypto.randomUUID(),
      role:    'assistant',
      content: '',
      loading: true,
    }

    setMessages((prev) => [...prev, userMsg, assistantMsg])
    setInput('')
    setStreaming(true)

    // Build history for context (last 6 messages, excluding current)
    const history = messages.slice(-6).map((m) => ({
      role:    m.role,
      content: m.content,
    }))

    try {
      const response = await fetch('/api/assistant', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ message: text.trim(), history }),
      })

      if (!response.ok || !response.body) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id
              ? { ...m, content: 'The Observatory Assistant is temporarily unavailable.', loading: false }
              : m,
          ),
        )
        return
      }

      const reader  = response.body.getReader()
      const decoder = new TextDecoder()
      let accumulated = ''
      let contextData: Message['context'] | undefined

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        const lines = chunk.split('\n')

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6)
          if (data === '[DONE]') continue

          try {
            const parsed = JSON.parse(data) as {
              type: 'meta' | 'text'
              content?: string
              context?: Message['context']
            }

            if (parsed.type === 'meta' && parsed.context) {
              contextData = parsed.context
            } else if (parsed.type === 'text' && parsed.content) {
              accumulated += parsed.content
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsg.id
                    ? { ...m, content: accumulated, context: contextData, loading: false } as Message
                    : m,
                ),
              )
            }
          } catch {
            // Skip malformed
          }
        }
      }

      // Ensure loading is cleared
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsg.id ? { ...m, loading: false } : m,
        ),
      )

    } catch {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsg.id
            ? { ...m, content: 'Connection error. Please try again.', loading: false }
            : m,
        ),
      )
    } finally {
      setStreaming(false)
      inputRef.current?.focus()
    }
  }, [messages, streaming])

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault()
    void sendMessage(input)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void sendMessage(input)
    }
  }

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 56px)' }}>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          /* Welcome state */
          <div className="mx-auto max-w-2xl px-6 py-12">
            <div className="mb-8 text-center">
              <div className="mb-4 flex items-center justify-center gap-2">
                <Pulse size="md" />
                <span className="font-mono text-xs tracking-[0.3em] text-text-muted">
                  OBSERVATORY ASSISTANT
                </span>
              </div>
              <h1 className="mb-3 text-xl font-light text-text-primary">
                Ask the Observatory
              </h1>
              <p className="text-sm text-text-muted">
                I answer only from verified Observatory signals, events and reports.
                I will tell you when I don&apos;t have enough information.
              </p>
            </div>

            {/* Example queries */}
            <div className="space-y-2">
              <p className="mb-3 font-mono text-xs tracking-wider text-text-muted">
                EXAMPLE QUERIES
              </p>
              {EXAMPLE_QUERIES.map((q) => (
                <button
                  key={q}
                  onClick={() => void sendMessage(q)}
                  className="w-full border border-observatory-border px-4 py-3 text-left text-sm text-text-muted transition-colors hover:border-text-muted hover:text-text-secondary"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          /* Message thread */
          <div className="mx-auto max-w-2xl px-6 py-6 space-y-6">
            {messages.map((msg) => (
              <div key={msg.id} className={cn('flex flex-col', msg.role === 'user' && 'items-end')}>

                {/* Role label */}
                <p className="mb-1.5 font-mono text-xs text-text-muted">
                  {msg.role === 'user' ? 'YOU' : 'OBSERVATORY'}
                </p>

                {/* Message bubble */}
                <div
                  className={cn(
                    'max-w-[85%] px-4 py-3 text-sm leading-relaxed',
                    msg.role === 'user'
                      ? 'bg-observatory-surface text-text-secondary border border-observatory-border'
                      : 'text-text-secondary',
                  )}
                >
                  {msg.loading ? (
                    <div className="flex items-center gap-2">
                      <Pulse size="sm" />
                      <span className="text-xs text-text-muted">Querying Observatory...</span>
                    </div>
                  ) : (
                    <div className="whitespace-pre-wrap">{msg.content}</div>
                  )}
                </div>

                {/* Context badge */}
                {msg.context && !msg.loading && (
                  <p className="mt-1.5 font-mono text-xs text-text-muted">
                    Based on {msg.context.signals} signal{msg.context.signals !== 1 ? 's' : ''}
                    {msg.context.events > 0 && `, ${msg.context.events} event${msg.context.events !== 1 ? 's' : ''}`}
                    {msg.context.reports > 0 && `, ${msg.context.reports} report${msg.context.reports !== 1 ? 's' : ''}`}
                  </p>
                )}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="border-t border-observatory-border bg-observatory-black">
        <div className="mx-auto max-w-2xl px-6 py-4">
          <form onSubmit={handleSubmit} className="flex gap-3">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about signals, events, or AI ecosystem developments..."
              rows={1}
              disabled={streaming}
              className="flex-1 resize-none border border-observatory-border bg-observatory-surface px-4 py-2.5 text-sm text-text-primary placeholder-text-muted outline-none focus:border-text-muted transition-colors disabled:opacity-50"
              style={{ minHeight: '42px', maxHeight: '120px' }}
              onInput={(e) => {
                const el = e.currentTarget
                el.style.height = 'auto'
                el.style.height = `${Math.min(el.scrollHeight, 120)}px`
              }}
            />
            <button
              type="submit"
              disabled={streaming || !input.trim()}
              className="shrink-0 border border-observatory-border px-4 py-2.5 font-mono text-xs tracking-wider text-text-muted transition-colors hover:border-text-muted hover:text-text-secondary disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {streaming ? '...' : 'ASK'}
            </button>
          </form>
          <p className="mt-2 text-center font-mono text-xs text-text-muted">
            Observatory answers are grounded in verified signals and events only
          </p>
        </div>
      </div>
    </div>
  )
}
