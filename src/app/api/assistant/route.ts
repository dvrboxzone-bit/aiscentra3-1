/**
 * AIscentra — Observatory Assistant API (Phase 1A: Emergency API Containment)
 *
 * POST /api/assistant
 * Body: { message: string, history?: { role: string, content: string }[] }
 *
 * Returns: streaming text response (Server-Sent Events)
 *
 * ACCESS: production access is fully disabled pending authenticated
 * sessions and quotas (a full user-auth system is explicitly out of scope
 * for this containment phase). The route returns a safe 503 before any
 * Observatory retrieval or Groq call — no Supabase query and no outbound
 * AI request happens when access is denied. "preview-only" mode is only
 * honored outside Vercel/NODE_ENV production (production always forces
 * disabled regardless of configuration).
 *
 * `retrieveContext` (src/modules/assistant/retrieval.ts) transitively
 * imports src/lib/supabase/server.ts, which in turn imports
 * src/config/env.ts — whose top-level `export const env = {...}` block
 * eagerly throws if NEXT_PUBLIC_SUPABASE_URL is missing, merely by being
 * imported. To ensure a disabled/denied request never triggers that (or
 * any real Supabase/Groq call), retrieval and prompt-building are loaded
 * via `await import(...)` ONLY after the access guard has already passed.
 *
 * Pattern (once access is allowed):
 * 1. Retrieve relevant context from Observatory (RAG)
 * 2. Build grounded prompt with context
 * 3. Stream response from OpenRouter
 * 4. Never answer from general AI knowledge
 */
import { checkPublicAssistantAccess } from '@/lib/security/api-access'

export const dynamic = 'force-dynamic'
export const maxDuration = 30 // Assistant can take longer than pipeline functions

interface MessageHistory {
  role: 'user' | 'assistant'
  content: string
}

export async function POST(request: Request): Promise<Response> {
  // ── Guard runs before ANY retrieval or Groq call — and before either is
  //    even imported ──────────────────────────────────────────────────────────
  const guard = checkPublicAssistantAccess()
  if (!guard.allowed) {
    console.error(`[api/assistant] ${guard.internalReason}`)
    return guard.response
  }

  // ── Only now, after the guard passed, load retrieval (which transitively
  //    imports Supabase) ──────────────────────────────────────────────────────
  const { retrieveContext, formatContextForPrompt } = await import('@/modules/assistant/retrieval')
  const { ASSISTANT_SYSTEM_PROMPT } = await import('@/modules/assistant/prompt')

  let body: { message?: string; history?: MessageHistory[] } = {}
  try {
    body = (await request.json()) as typeof body
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const userMessage = body.message?.trim()
  if (!userMessage || userMessage.length < 2) {
    return new Response(JSON.stringify({ error: 'Message too short' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // 1. Retrieve Observatory context (RAG)
  const ctx = await retrieveContext(userMessage)
  const contextText = formatContextForPrompt(ctx)

  // 2. Build messages — system prompt in correct role
  type Msg = { role: 'system' | 'user' | 'assistant'; content: string }
  const messages: Msg[] = [
    {
      role: 'system',
      content: `${ASSISTANT_SYSTEM_PROMPT}\n\n=== OBSERVATORY CONTEXT ===\n${contextText}\n=== END CONTEXT ===`,
    },
  ]
  if (body.history && body.history.length > 0) {
    const hist = (body.history.slice(-6) as Msg[]).filter(
      (m) => m.role === 'user' || m.role === 'assistant',
    )
    messages.push(...hist)
  }
  messages.push({ role: 'user', content: userMessage })

  // 3. Call Groq with streaming (OpenAI-compatible API)
  const groqApiKey = process.env['GROQ_API_KEY']
  if (!groqApiKey) {
    return new Response(JSON.stringify({ error: 'Assistant temporarily unavailable.' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const model = process.env['AI_PRIMARY_MODEL'] ?? 'llama-3.3-70b-versatile'
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${groqApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: 2000,
      temperature: 0.3,
      stream: true,
    }),
  })

  if (!response.ok || !response.body) {
    const error = await response.text()
    console.error('[assistant] OpenRouter error:', response.status, error)
    return new Response(
      JSON.stringify({ error: 'Assistant temporarily unavailable. Please try again.' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    )
  }

  // 4. Forward the SSE stream to the client
  // Transform OpenRouter SSE format to simple text stream
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()

  const stream = new ReadableStream({
    async start(controller) {
      // Add context metadata as first chunk
      const meta = JSON.stringify({
        type: 'meta',
        context: {
          signals: ctx.signals.length,
          events: ctx.events.length,
          reports: ctx.reports.length,
        },
      })
      controller.enqueue(encoder.encode(`data: ${meta}\n\n`))

      const body = response.body
      if (!body) {
        throw new Error(
          'Invariant violated: response.body is null inside the stream start() callback, despite the earlier response.ok/response.body check having passed.',
        )
      }
      const reader = body.getReader()

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          const chunk = decoder.decode(value, { stream: true })
          const lines = chunk.split('\n')

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            const data = line.slice(6)
            if (data === '[DONE]') {
              controller.enqueue(encoder.encode('data: [DONE]\n\n'))
              continue
            }

            try {
              const parsed = JSON.parse(data) as {
                choices: { delta: { content?: string } }[]
              }
              const content = parsed.choices[0]?.delta?.content
              if (content) {
                const textChunk = JSON.stringify({ type: 'text', content })
                controller.enqueue(encoder.encode(`data: ${textChunk}\n\n`))
              }
            } catch {
              // Skip malformed chunks
            }
          }
        }
      } catch (err) {
        console.error('[assistant] Stream error:', err)
      } finally {
        controller.close()
        reader.releaseLock()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
