/**
 * AIscentra — Signal Engine V2 Dry-Run Simulation (Phase 1A: Emergency API Containment)
 *
 * POST /api/admin/simulate-engine-v2
 * Authorization: Bearer <ADMIN_API_SECRET>
 *
 * GET is no longer supported and never reaches the database, AI provider,
 * or any privileged operation — it is rejected before any of that code is
 * even imported. Previously this route was a fully public GET that
 * constructed a service-role Supabase client (bypassing RLS), called Groq,
 * and wrote a row to engine_simulation_runs, all without any
 * authentication.
 *
 * Access requires ALL of, checked strictly in this order:
 *   1. method === POST
 *   2. ENABLE_ENGINE_SIMULATION === 'true'
 *   3. a valid Bearer token matching ADMIN_API_SECRET (constant-time compare)
 *
 * `createAdminClient` (from src/lib/supabase/server.ts) transitively
 * imports src/config/env.ts, whose top-level `export const env = {...}`
 * block eagerly throws if NEXT_PUBLIC_SUPABASE_URL is missing — merely
 * importing that module, even without calling anything, can crash before
 * the guard runs. The AI implementation is loaded the same way for
 * defense-in-depth. Both are therefore behind deps.loadAdminClient() /
 * deps.callAI(), called ONLY after the admin guard has already passed.
 *
 * DEPENDENCY INJECTION: createAdminPostHandler(deps) is a factory, not a
 * global-state route. Production wiring (POST, exported below) injects
 * real lazy-loading dependencies. Tests construct fake `deps` with local
 * counters and canned data — no real database or AI call, no test state
 * living inside this module as a mutable export.
 *
 * Pure, deterministic Signal Engine functions (checkHardRejection,
 * computeSIS, buildSISPrompt, classifyPublicationType, etc.) read no
 * environment variables and construct no clients, so they remain ordinary
 * static top-level imports.
 *
 * Signal Engine logic, SIS scoring, and simulation behavior are UNCHANGED
 * by this task — only the access-control wrapper and the dependency-
 * injection boundary around the existing behavior were added.
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { checkHardRejection, V2_THRESHOLDS } from '@/modules/signals/pre-qualification'
import {
  SISOutputSchema,
  SIS_SYSTEM_PROMPT,
  buildSISPrompt,
  computeSIS,
} from '@/modules/signals/strategic-score'
import type { ObservationRow } from '@/modules/observations/queries'
import { checkAdminAccess, methodNotAllowedResponse } from '@/lib/security/api-access'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

type SimResult = {
  observation_id: string
  title: string
  source: string
  v1_had_signal: boolean
  hard_rejected: boolean
  rejection_code: string | null
  sis_final: number | null
  human_roles_yes: number | null
  v2_decision: string
  engine_justification: string
  decision_changed: boolean
  publication_type?: string
  rule_trace?: string[]
}

type ObservationWithSource = ObservationRow & {
  sources: { name: string; type: string; trust_score: number } | null
  signal_id: string | null
}

// ── Dependency injection contract ────────────────────────────────────────────

export interface ReadObservationsResult {
  data: ObservationWithSource[] | null
  error: unknown
}

export interface SimulationRunPayload {
  run_type: string
  observation_ids: string[]
  results: SimResult[]
  summary: unknown
  engine_version: string
  status: string
  completed_at: string
}

export interface AdminDependencies {
  /** Loads (in production: dynamically imports + constructs) the service-role Supabase client. */
  loadAdminClient: () => Promise<unknown>
  /** Reads the up-to-3 most recent processed observations, with their source, via the given client. */
  readObservations: (client: unknown) => Promise<ReadObservationsResult>
  /**
   * Performs the SIS classification AI call for one observation. May
   * throw. The real implementation never lets the raw error reach the
   * caller of the HANDLER (that redaction happens in the handler's own
   * catch block, using `isRateLimitError` to classify without needing the
   * raw message) — this function itself is allowed to throw an arbitrary
   * error, exactly matching how the real underlying agentCompleteJSON()
   * behaves, since redaction is the handler's job, not this dependency's.
   */
  callAI: (input: {
    title: string
    content: string
    sourceName: string
    sourceType: string
  }) => Promise<unknown>
  /** Classifies whether a thrown error represents a rate-limit condition, without exposing its raw content. */
  isRateLimitError: (err: unknown) => boolean
  /** Persists the simulation run summary. Never receives or forwards raw provider error content. */
  writeSimulationRun: (client: unknown, payload: SimulationRunPayload) => Promise<void>
}

const productionAdminDependencies: AdminDependencies = {
  loadAdminClient: async () => {
    const { createAdminClient } = await import('@/lib/supabase/server')
    return createAdminClient()
  },
  readObservations: async (client) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (client as any)
      .from('observations')
      .select('*, sources(name, type, trust_score)')
      .eq('processed', true)
      .order('collected_at', { ascending: false })
      .limit(3)
    return { data: (data ?? null) as ObservationWithSource[] | null, error }
  },
  callAI: async ({ title, content, sourceName, sourceType }) => {
    const { agentCompleteJSON } = await import('@/lib/ai/agent')
    const raw = await agentCompleteJSON(
      'classifier',
      [
        { role: 'system', content: SIS_SYSTEM_PROMPT },
        { role: 'user', content: buildSISPrompt(title, content, sourceName, sourceType) },
      ],
      SISOutputSchema,
      { temperature: 0, maxTokens: 400 },
    )
    return raw
  },
  isRateLimitError: (err) => {
    // Lazily checking the class here (rather than a static top-level
    // import of AIProviderError) keeps this dependency's module graph
    // consistent with the rest of this file's lazy-import discipline,
    // even though AIProviderError itself does not read any environment
    // variable at import time.
    return (
      typeof err === 'object' &&
      err !== null &&
      'isRateLimit' in err &&
      (err as { isRateLimit: unknown }).isRateLimit === true
    )
  },
  writeSimulationRun: async (client, payload) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (client as any).from('engine_simulation_runs').insert(payload)
  },
}

// ── Handler factory ────────────────────────────────────────────────────────────

export function createAdminGetHandler() {
  return async function GET(): Promise<NextResponse> {
    // GET never touches Supabase, the admin client, or any AI provider —
    // rejected before any of that code is even imported.
    return methodNotAllowedResponse('POST')
  }
}

export function createAdminPostHandler(deps: AdminDependencies) {
  return async function POST(request: NextRequest): Promise<NextResponse> {
    // ── Guard runs before any deps.* function is ever called ─────────────────
    const guard = checkAdminAccess(request)
    if (!guard.allowed) {
      console.error(`[api/admin/simulate-engine-v2] ${guard.internalReason}`)
      return guard.response
    }

    const client = await deps.loadAdminClient()

    const { data: rows, error } = await deps.readObservations(client)
    if (error) return NextResponse.json({ error: 'Simulation failed' }, { status: 500 })

    const observations = rows ?? []
    if (observations.length === 0) {
      return NextResponse.json({ error: 'No processed observations' })
    }

    const results: SimResult[] = []

    for (const obs of observations) {
      const sourceType = obs.sources?.type ?? ''
      const sourceName = obs.sources?.name ?? 'Unknown'
      const item: SimResult = {
        observation_id: obs.id,
        title: obs.title.slice(0, 80),
        source: sourceName,
        v1_had_signal: !!obs.signal_id,
        hard_rejected: false,
        rejection_code: null,
        sis_final: null,
        human_roles_yes: null,
        v2_decision: 'UNKNOWN',
        engine_justification: '',
        decision_changed: false,
      }

      const hardCheck = checkHardRejection(obs, sourceType)
      if (hardCheck.rejected) {
        item.hard_rejected = true
        item.rejection_code = hardCheck.code
        item.v2_decision = 'DISCARD'
        item.engine_justification = `Rule ${hardCheck.code}: ${hardCheck.reason}`
        item.decision_changed = !!obs.signal_id
        results.push(item)
        continue
      }

      try {
        const sisRaw = await deps.callAI({
          title: obs.title,
          content: obs.content,
          sourceName,
          sourceType,
        })
        const sis = computeSIS(sisRaw as Parameters<typeof computeSIS>[0], obs.title, obs.content)
        item.sis_final = sis.sis.final
        item.human_roles_yes = sis.human_relevance.roles_yes_count
        item.v2_decision = sis.decision
        item.engine_justification = sis.engine_justification
        item.publication_type = sis.publication_type.type
        item.rule_trace = sis.rule_trace
        item.decision_changed =
          !!obs.signal_id !== (sis.decision === 'SIGNAL' || sis.decision === 'WEAK_SIGNAL')
      } catch (err) {
        const isRateLimited = deps.isRateLimitError(err)
        item.v2_decision = isRateLimited ? 'RATE_LIMITED' : 'ERROR'
        // Client-facing engine_justification is a FIXED, safe string —
        // never err.message or String(err), which can contain raw
        // provider response bodies, prompt fragments, or other payload
        // content.
        item.engine_justification = isRateLimited
          ? 'AI provider rate limit reached'
          : 'AI provider request failed'

        // Server-side log: only safe, structured signals — observation
        // ID and a boolean rate-limit flag, no raw message body, no
        // prompt, no observation content, no provider payload.
        console.error('[api/admin/simulate-engine-v2] AI call failed', {
          observationId: obs.id,
          rateLimited: isRateLimited,
        })
      }
      results.push(item)
    }

    const summary = {
      total: results.length,
      hard_rejected: results.filter((r) => r.hard_rejected).length,
      v2_signal: results.filter((r) => r.v2_decision === 'SIGNAL').length,
      v2_weak_signal: results.filter((r) => r.v2_decision === 'WEAK_SIGNAL').length,
      v2_discard: results.filter((r) => r.v2_decision === 'DISCARD').length,
      decision_changed: results.filter((r) => r.decision_changed).length,
      thresholds: V2_THRESHOLDS,
    }

    await deps.writeSimulationRun(client, {
      run_type: 'dry_run',
      observation_ids: observations.map((o) => o.id),
      results,
      summary,
      engine_version: 'v2.0',
      status: 'COMPLETE',
      completed_at: new Date().toISOString(),
    })

    return NextResponse.json({
      summary,
      verdict:
        summary.decision_changed > 0
          ? `V2 изменит ${summary.decision_changed} из ${summary.total} решений. Проверьте перед включением.`
          : `V2 совпадает с V1 по всем ${summary.total} наблюдениям. Можно включать.`,
      results,
    })
  }
}

// ── Production wiring ────────────────────────────────────────────────────────

export const GET = createAdminGetHandler()
export const POST = createAdminPostHandler(productionAdminDependencies)
