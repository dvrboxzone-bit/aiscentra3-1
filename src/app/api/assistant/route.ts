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
 * honored in a recognized non-production environment (production always
 * forces disabled regardless of configuration).
 *
 * `retrieveContext` (src/modules/assistant/retrieval.ts) transitively
 * imports src/lib/supabase/server.ts, which in turn imports
 * src/config/env.ts — whose top-level `export const env = {...}` block
 * eagerly throws if NEXT_PUBLIC_SUPABASE_URL is missing, merely by being
 * imported. To ensure a disabled/denied request never triggers that (or
 * any real Supabase/Groq call), retrieval and prompt-building are loaded
 * via deps.loadRetrieval() ONLY after the access guard has already passed.
 *
 * DEPENDENCY INJECTION: createAssistantPostHandler(deps) is a factory, not
 * a global-state route. Production wiring (POST, exported below) injects
 * real lazy-loading dependencies and the real fetch(). Tests inject fakes
 * with local counters and a stubbed streaming Response — no real network
 * call, no test state living inside this module as a mutable export.
 *
 * Pattern (once access is allowed):
 * 1. Check and increment the daily quota for this client IP (per-IP +
 *    global caps — see src/modules/assistant/quota.ts)
 * 2. Retrieve relevant context from Observatory (RAG)
 * 3. Build grounded prompt with context
 * 4. Stream response from Groq
 * 5. Never answer from general AI knowledge
 */
import { checkPublicAssistantAccess } from '@/lib/security/api-access'
import {
  checkAndIncrementQuota,
  getClientIp,
  type QuotaCheckResult,
} from '@/modules/assistant/quota'
import type { RetrievedContext } from '@/modules/assistant/retrieval'

export const dynamic = 'force-dynamic'
export const maxDuration = 30 // Assistant can take longer than pipeline functions

interface MessageHistory {
  role: 'user' | 'assistant'
  content: string
}

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

// ── Dependency injection contract ────────────────────────────────────────────

export interface RetrievalModule {
  retrieveContext: (userQuery: string) => Promise<RetrievedContext>
  formatContextForPrompt: (ctx: RetrievedContext) => string
  ASSISTANT_SYSTEM_PROMPT: string
}

export interface AssistantDependencies {
  /** Loads retrieval + prompt modules. In production this transitively imports Supabase — called only after the guard passes. */
  loadRetrieval: () => Promise<RetrievalModule>
  /** Checks and, if allowed, increments the daily quota for this client IP. Lazily loads the admin Supabase client in production — same reasoning as loadRetrieval above: never imported before the access guard has already passed. */
  checkQuota: (ip: string) => Promise<QuotaCheckResult>
  /**
   * Reserves shared Groq TPD budget before the Assistant's own direct
   * fetch. The Assistant bypasses src/lib/ai/client.ts entirely, so the
   * gate wired into agent.ts does NOT cover it -- without this it could
   * spend the Signal Engine's reserved budget once enabled. Throws
   * AITokenBudgetExceededError to refuse.
   */
  reserveBudget: (model: string, estimatedTokens: number) => Promise<void>
  /** Performs the Groq chat-completions call. Wrapped so tests can supply a fake streaming Response without any real network call. */
  fetchGroq: (args: { apiKey: string; model: string; messages: ChatMessage[] }) => Promise<Response>
  /** Reads the Groq API key. Production reads process.env directly; tests can override to simulate a missing key. */
  getGroqApiKey: () => string | undefined
  /** Reads the preferred Groq model. Production reads process.env with a documented fallback. */
  getGroqModel: () => string
}

const productionAssistantDependencies: AssistantDependencies = {
  loadRetrieval: async () => {
    const { retrieveContext, formatContextForPrompt } = await import(
      '@/modules/assistant/retrieval'
    )
    const { ASSISTANT_SYSTEM_PROMPT } = await import('@/modules/assistant/prompt')
    return { retrieveContext, formatContextForPrompt, ASSISTANT_SYSTEM_PROMPT }
  },
  reserveBudget: async (model: string, estimatedTokens: number) => {
    const { reserveGroqBudget } = await import('@/lib/ai/budget-gate')
    await reserveGroqBudget({ model, consumer: 'assistant', estimatedTokens })
  },
  checkQuota: async (ip: string) => {
    // Lazily imported -- same reasoning as loadRetrieval above:
    // createAdminClient transitively imports config/env.ts, whose
    // top-level `export const env = {...}` throws eagerly if
    // NEXT_PUBLIC_SUPABASE_URL is missing, merely by being imported.
    // A denied (503) request must never trigger that.
    const { createAdminClient } = await import('@/lib/supabase/server')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the existing convention in src/modules/observations/queries.ts for the same reason: Supabase's generic client type is not worth fighting for a handful of simple queries against a table with no generated types yet.
    const client = createAdminClient() as any
    return checkAndIncrementQuota(client, ip)
  },
  fetchGroq: ({ apiKey, model, messages }) =>
    fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: 2000,
        temperature: 0.3,
        stream: true,
      }),
    }),
  getGroqApiKey: () => process.env['GROQ_API_KEY'],
  getGroqModel: () => process.env['AI_PRIMARY_MODEL'] ?? 'llama-3.3-70b-versatile',
}

// ── Handler factory ────────────────────────────────────────────────────────────

export function createAssistantPostHandler(deps: AssistantDependencies) {
  return async function POST(request: Request): Promise<Response> {
    // ── Guard runs before ANY retrieval or Groq call — and before either is
    //    even imported ───────────────────────────────────────────────────────
    const guard = checkPublicAssistantAccess()
    if (!guard.allowed) {
      console.error(`[api/assistant] ${guard.internalReason}`)
      return guard.response
    }

    // ── Quota check — after the access guard, before any retrieval or Groq
    //    call. Fails open on a database error (see checkAndIncrementQuota's
    //    own docstring) -- a quota-tracking outage degrades to "no quota
    //    enforced today," not "Assistant fully down."
    //
    //    Placeholder response text below: matches the temporary,
    //    infrastructure-honest tone agreed for this stage (not the final
    //    Editorial Voice, which is pending the signal-style-repair work in
    //    PR #34/#35 landing first) -- explicitly framed as a shared,
    //    temporary capacity limit, never as a paywall, since this product
    //    has no paid tiers at all.
    const clientIp = getClientIp(request)
    const quota = await deps.checkQuota(clientIp)
    if (!quota.allowed) {
      const message =
        quota.reason === 'global'
          ? "The Assistant has reached today's shared capacity. Signals, events, and reports are still fully available."
          : 'Daily limit reached. Resets at midnight UTC.'
      return new Response(JSON.stringify({ error: message }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // ── Only now, after the guard passed, load retrieval (which transitively
    //    imports Supabase) ─────────────────────────────────────────────────────
    const { retrieveContext, formatContextForPrompt, ASSISTANT_SYSTEM_PROMPT } =
      await deps.loadRetrieval()

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
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: `${ASSISTANT_SYSTEM_PROMPT}\n\n=== OBSERVATORY CONTEXT ===\n${contextText}\n=== END CONTEXT ===`,
      },
    ]
    if (body.history && body.history.length > 0) {
      const hist = (body.history.slice(-6) as ChatMessage[]).filter(
        (m) => m.role === 'user' || m.role === 'assistant',
      )
      messages.push(...hist)
    }
    messages.push({ role: 'user', content: userMessage })

    // 3. Call Groq with streaming (OpenAI-compatible API)
    const groqApiKey = deps.getGroqApiKey()
    if (!groqApiKey) {
      return new Response(JSON.stringify({ error: 'Assistant temporarily unavailable.' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const model = deps.getGroqModel()

    // Shared TPD budget gate -- MUST precede the fetch. The Assistant
    // may only consume what remains above the Signal Engine's reserve,
    // and is fail-closed when budget state is unknown (see
    // src/lib/ai/token-budget.ts). Refusal returns before Groq is ever
    // contacted, so a refused request costs zero tokens.
    try {
      const promptChars = messages.reduce((n, m) => n + m.content.length, 0)
      await deps.reserveBudget(model, Math.ceil(promptChars / 4) + 2000)
    } catch {
      return new Response(
        JSON.stringify({
          error:
            "The Assistant has reached today's shared capacity. Signals, events, and reports are still fully available.",
        }),
        { status: 429, headers: { 'Content-Type': 'application/json' } },
      )
    }

    const response = await deps.fetchGroq({ apiKey: groqApiKey, model, messages })

    if (!response.ok || !response.body) {
      const errorText = await response.text()
      console.error('[assistant] Groq error:', response.status, errorText)
      return new Response(
        JSON.stringify({ error: 'Assistant temporarily unavailable. Please try again.' }),
        { status: 503, headers: { 'Content-Type': 'application/json' } },
      )
    }

    // 4. Forward the SSE stream to the client
    const encoder = new TextEncoder()
    const decoder = new TextDecoder()

    const stream = new ReadableStream({
      async start(controller) {
        const meta = JSON.stringify({
          type: 'meta',
          context: {
            signals: ctx.signals.length,
            events: ctx.events.length,
            reports: ctx.reports.length,
          },
        })
        controller.enqueue(encoder.encode(`data: ${meta}\n\n`))

        const responseBody = response.body
        if (!responseBody) {
          throw new Error(
            'Invariant violated: response.body is null inside the stream start() callback, despite the earlier response.ok/response.body check having passed.',
          )
        }
        const reader = responseBody.getReader()

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
}

// ── Production wiring ────────────────────────────────────────────────────────

export const POST = createAssistantPostHandler(productionAssistantDependencies)
