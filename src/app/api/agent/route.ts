/**
 * AIscentra — Agent Runtime HTTP Integration (Phase 1A: Emergency API Containment)
 *
 * POST /api/agent
 * Authorization: Bearer <INTERNAL_API_SECRET>
 * Body: { query: string }
 *
 * GET is no longer supported and never reaches the Runtime — it exists only
 * to return an explicit 405, since a bare GET was the original vulnerability
 * (unauthenticated, cost-triggering, over-disclosing endpoint).
 *
 * Access requires ALL of, checked strictly in this order:
 *   1. method === POST
 *   2. ENABLE_INTERNAL_AGENT_API === 'true'
 *   3. a valid Bearer token matching INTERNAL_API_SECRET (constant-time compare)
 *   4. request body parses as JSON
 *   5. body passes strict Zod validation
 *
 * Only AFTER all five checks pass does this module dynamically `import()`
 * the Agent Runtime (buildProductionRuntime, routeTask). This is
 * deliberate: a static top-level import of Runtime code would load and
 * evaluate that module graph on every request to this route — including
 * unauthorized ones — before the guard even runs. The dynamic import
 * inside the authorized branch means an unauthorized/invalid request never
 * causes the Runtime module (and anything it transitively imports —
 * Supabase providers, GroqReasoningEngine, etc.) to be loaded at all.
 *
 * The client receives a minimal, sanitized DTO only — never the full
 * internal AgentRunResult (no execution plan, no raw context, no provider
 * payloads, no internal step diagnostics, no evidence IDs referencing
 * internal Observatory records).
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { checkInternalAccess, methodNotAllowedResponse } from '@/lib/security/api-access'
// Type-only import — erased entirely from runtime output, does not trigger
// module evaluation. Verified: `tsc`'s `isolatedModules`/`verbatimModuleSyntax`-
// style erasure removes `import type` statements completely at compile time.
import type {
  AgentTask,
  AgentRunResult,
} from '../../../../supabase/functions/intelligence-agent/index'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

const RequestBodySchema = z
  .object({
    query: z.string().trim().min(2).max(500),
  })
  .strict()

interface AgentApiClaim {
  type: string
  statement: string
  confidence: number
}

interface AgentApiResponse {
  taskId: string
  status: 'success' | 'failed'
  summary: string
  claims: AgentApiClaim[]
  gaps: string[]
  confidence: number
}

/**
 * Builds the client-facing DTO from the full internal AgentRunResult.
 * Deliberately omits: execution plan, raw context (observations/signals/
 * graph/memory/entities), provider payloads, per-step diagnostics, and
 * claim evidenceIds (which reference internal Observatory record IDs).
 *
 * Pure function — no imports of Runtime code, no I/O. Exported specifically
 * as a testable seam: tests can construct a fake AgentRunResult and assert
 * on the DTO shape without ever touching the real Runtime.
 */
export function buildSafeAgentResponse(result: AgentRunResult): AgentApiResponse {
  const reasoning = result.execution.reasoning

  return {
    taskId: result.task.id,
    status: result.reflection.success ? 'success' : 'failed',
    summary: reasoning?.summary ?? 'No reasoning result available for this task.',
    claims: (reasoning?.claims ?? []).map((claim) => ({
      type: claim.type,
      statement: claim.statement,
      confidence: claim.confidence,
    })),
    gaps: reasoning?.gapsIdentified ?? [],
    confidence: result.reflection.confidence,
  }
}

export async function GET(): Promise<NextResponse> {
  // GET never touches the Runtime, Supabase, or Groq — rejected before any
  // of that code is even imported.
  return methodNotAllowedResponse('POST')
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // ── 1-3. Guard runs before anything else, including body parsing ───────────
  // No Runtime module is imported anywhere above this line.
  const guard = checkInternalAccess(request)
  if (!guard.allowed) {
    console.error(`[api/agent] ${guard.internalReason}`)
    return guard.response
  }

  // ── 4-5. Strict body validation — still before any Runtime import ──────────
  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = RequestBodySchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request body', issues: parsed.error.issues.map((i) => i.message) },
      { status: 400 },
    )
  }

  const query = parsed.data.query

  // ── Only now, after all five checks passed, load the Runtime ────────────────
  const { buildProductionRuntime, routeTask } = await import(
    '../../../../supabase/functions/intelligence-agent/index'
  )

  const task: AgentTask = {
    id: `task-${Date.now()}`,
    type: routeTask(query),
    query,
    parameters: {},
    requestedBy: 'http-api',
    createdAt: new Date().toISOString(),
  }

  let result: AgentRunResult
  try {
    const runtime = buildProductionRuntime()
    result = await runtime.run(task)
  } catch (err) {
    const requestId = task.id
    // Sanitized server-side log only — the raw error (which may contain
    // provider response bodies, stack traces, or internal paths) never
    // reaches the client.
    console.error(
      `[api/agent] request ${requestId} failed:`,
      err instanceof Error ? err.message : String(err),
    )
    return NextResponse.json(
      { error: 'Agent Runtime execution failed', requestId },
      { status: 500 },
    )
  }

  return NextResponse.json(buildSafeAgentResponse(result))
}
