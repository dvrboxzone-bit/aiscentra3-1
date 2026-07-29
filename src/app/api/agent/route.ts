/**
 * AIscentra — Agent Runtime HTTP Integration
 *
 * GET /api/agent?q=<query>
 *
 * Production endpoint that invokes the EXISTING Agent Runtime
 * (supabase/functions/intelligence-agent/) exactly as-is. No Runtime file
 * is modified by this route — this file only imports and calls the
 * already-existing public API surface (buildProductionRuntime, AgentTask).
 *
 * Pipeline:
 *   HTTP Request
 *     ↓ validate input (query param)
 *   buildProductionRuntime()
 *     ↓ (SupabaseObservationProvider, SupabaseSignalProvider,
 *        SupabaseGraphProvider, SupabaseMemoryProvider, GroqReasoningEngine,
 *        DefaultSafetyProvider, ConsoleAgentLogger — all pre-existing classes)
 *   AgentRuntime.run(task)
 *     ↓ Planner → Context Loader → Execution → Reflection (all pre-existing)
 *   AgentRunResult (includes ExecutionResult)
 *     ↓
 *   HTTP Response (full JSON, no truncation)
 *
 * GET (not POST) is used deliberately so this can be triggered directly from
 * a browser URL bar or curl without a request body — consistent with the
 * existing /api/admin/simulate-engine-v2 pattern already used in this project
 * for on-demand diagnostic invocation.
 */
import { NextRequest, NextResponse } from 'next/server'
import { buildProductionRuntime, routeTask } from '../../../../supabase/functions/intelligence-agent/index'
import type { AgentTask } from '../../../../supabase/functions/intelligence-agent/index'

export const maxDuration = 60
export const dynamic     = 'force-dynamic'

const MAX_QUERY_LENGTH = 500

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url)
  const rawQuery = searchParams.get('q')

  // ── Validate input ──────────────────────────────────────────────────────────
  if (!rawQuery || typeof rawQuery !== 'string' || rawQuery.trim().length === 0) {
    return NextResponse.json(
      { error: 'Missing or empty required query parameter "q". Example: /api/agent?q=Investigate%20OpenAI' },
      { status: 400 },
    )
  }

  const query = rawQuery.trim().slice(0, MAX_QUERY_LENGTH)

  // ── Build task (mirrors the shape used by index.ts's own runTask()) ─────────
  const task: AgentTask = {
    id:          `task-${Date.now()}`,
    type:        routeTask(query),
    query,
    parameters:  {},
    requestedBy: 'http-api',
    createdAt:   new Date().toISOString(),
  }

  // ── Invoke the EXISTING Agent Runtime — zero modification to Runtime code ───
  let result
  try {
    const runtime = buildProductionRuntime()
    result = await runtime.run(task)
  } catch (err) {
    return NextResponse.json(
      {
        error: 'Agent Runtime execution failed',
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    )
  }

  return NextResponse.json(result)
}
