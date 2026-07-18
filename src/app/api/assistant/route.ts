/**
 * AIscentra — Observatory Assistant API
 *
 * POST /api/assistant
 * Body: { message: string, history?: { role: string, content: string }[] }
 *
 * Returns: streaming text response (Server-Sent Events)
 *
 * Pattern:
 * 1. Retrieve relevant context from Observatory (RAG)
 * 2. Build grounded prompt with context
 * 3. Stream response from OpenRouter
 * 4. Never answer from general AI knowledge
 */
import { createAdminClient } from '@/lib/supabase/server'
import { serverEnv } from '@/config/env'
import { retrieveContext, formatContextForPrompt } from '@/modules/assistant/retrieval'
import { buildAssistantPrompt } from '@/modules/assistant/prompt'

export const dynamic = 'force-dynamic'
export const maxDuration = 30  // Assistant can take longer than pipeline functions

interface MessageHistory {
  role:    'user' | 'assistant'
  content: string
}

export async function POST(request: Request): Promise<Response> {
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

  // 2. Build messages array
  const messages = [
    {
      role:    'user' as const,
      content: buildAssistantPrompt(contextText, userMessage),
    },
  ]

  // Include conversation history (without system context to avoid duplication)
  if (body.history && body.history.length > 0) {
    // Insert history before the current message
    messages.splice(0, 0, ...body.history.slice(-6))  // Last 3 exchanges max
  }

  // 3. Call OpenRouter with streaming
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${serverEnv.OPENROUTER_API_KEY}`,
      'Content-Type':  'application/json',
      'HTTP-Referer':  'https://aiscentra.com',
      'X-Title':       'AIscentra Observatory Assistant',
    },
    body: JSON.stringify({
      model:       serverEnv.OPENROUTER_MODEL,
      messages,
      max_tokens:  1000,
      temperature: 0.3,   // Slight creativity for natural responses, but grounded
      stream:      true,
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
          events:  ctx.events.length,
          reports: ctx.reports.length,
        },
      })
      controller.enqueue(encoder.encode(`data: ${meta}\n\n`))

      const reader = response.body!.getReader()

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
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
    },
  })
}
