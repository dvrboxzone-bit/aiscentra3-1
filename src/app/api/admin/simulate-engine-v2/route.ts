/**
 * AIscentra — Phase 0: Signal Engine V2 Dry-Run Simulation
 *
 * POST /api/admin/simulate-engine-v2
 * Body: { limit?: number } — default 20, max 100
 *
 * Runs V2 pipeline stages 1+3 on processed observations WITHOUT publishing.
 * Stores results in engine_simulation_runs for human review.
 *
 * Stages run in simulation:
 *   Stage 1: Hard rejection (R-01 to R-12) — zero cost
 *   Stage 3: SIS evaluation — cheap LLM call
 *
 * Stage 4 (full enrichment) is SKIPPED — simulation stays cheap.
 *
 * After review: if summary looks correct → enable V2 in production.
 */
import { NextRequest, NextResponse }  from 'next/server'
import { createAdminClient }          from '@/lib/supabase/server'
import { agentCompleteJSON }          from '@/lib/ai/agent'
import { AIProviderError }            from '@/lib/ai/client'
import {
  checkHardRejection,
  V2_THRESHOLDS,
}                                     from '@/modules/signals/pre-qualification'
import {
  SISOutputSchema,
  SIS_SYSTEM_PROMPT,
  buildSISPrompt,
  computeSIS,
}                                     from '@/modules/signals/strategic-score'
import type { ObservationRow }        from '@/modules/observations/queries'

export const maxDuration = 60
export const dynamic     = 'force-dynamic'

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env['CRON_SECRET']
  if (!secret) return false
  const header = request.headers.get('x-cron-secret') ?? request.headers.get('authorization')
  return header === secret || header === `Bearer ${secret}`
}

type SimResult = {
  observation_id:       string
  title:                string
  source:               string
  v1_had_signal:        boolean
  hard_rejected:        boolean
  rejection_code:       string | null
  rejection_reason:     string | null
  sis_evaluated:        boolean
  sis_novelty:          number | null
  sis_importance:       number | null
  sis_urgency:          number | null
  sis_confidence:       number | null
  sis_final:            number | null
  human_roles_yes:      number | null
  anti_hype_score:      number | null
  v2_decision:          string
  engine_justification: string
  decision_changed:     boolean
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { limit?: number } = {}
  try { body = await request.json() as { limit?: number } } catch { /* empty ok */ }

  const limit    = Math.min(body.limit ?? 20, 100)
  const supabase = createAdminClient()

  // Fetch processed observations
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rows, error } = await (supabase as any)
    .from('observations')
    .select('*, sources(name, type, trust_score)')
    .eq('processed', true)
    .order('collected_at', { ascending: false })
    .limit(limit)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const observations = (rows ?? []) as (ObservationRow & {
    sources: { name: string; type: string; trust_score: number } | null
    signal_id: string | null
  })[]

  if (observations.length === 0) {
    return NextResponse.json({ error: 'No processed observations found' })
  }

  const results: SimResult[] = []

  for (const obs of observations) {
    const sourceType = obs.sources?.type ?? ''
    const sourceName = obs.sources?.name ?? 'Unknown'

    const item: SimResult = {
      observation_id:       obs.id,
      title:                obs.title.slice(0, 100),
      source:               sourceName,
      v1_had_signal:        !!obs.signal_id,
      hard_rejected:        false,
      rejection_code:       null,
      rejection_reason:     null,
      sis_evaluated:        false,
      sis_novelty:          null,
      sis_importance:       null,
      sis_urgency:          null,
      sis_confidence:       null,
      sis_final:            null,
      human_roles_yes:      null,
      anti_hype_score:      null,
      v2_decision:          'UNKNOWN',
      engine_justification: '',
      decision_changed:     false,
    }

    // ── Stage 1: Hard rejection ─────────────────────────────────────────────
    const hardCheck = checkHardRejection(obs, sourceType)
    if (hardCheck.rejected) {
      item.hard_rejected        = true
      item.rejection_code       = hardCheck.code
      item.rejection_reason     = hardCheck.reason
      item.v2_decision          = 'DISCARD'
      item.engine_justification = `Hard rule ${hardCheck.code}: ${hardCheck.reason}`
      item.decision_changed     = !!obs.signal_id
      results.push(item)
      continue
    }

    // ── Stage 3: SIS evaluation ─────────────────────────────────────────────
    try {
      const sisRaw = await agentCompleteJSON(
        'classifier',
        [
          { role: 'system', content: SIS_SYSTEM_PROMPT },
          { role: 'user',   content: buildSISPrompt(obs.title, obs.content, sourceName, sourceType) },
        ],
        SISOutputSchema,
        { temperature: 0, maxTokens: 400 },
      )
      const sis = computeSIS(sisRaw as Parameters<typeof computeSIS>[0])

      item.sis_evaluated      = true
      item.sis_novelty        = sis.sis.novelty
      item.sis_importance     = sis.sis.importance
      item.sis_urgency        = sis.sis.urgency
      item.sis_confidence     = sis.sis.confidence
      item.sis_final          = sis.sis.final
      item.human_roles_yes    = sis.human_relevance.roles_yes_count
      item.anti_hype_score    = sis.anti_hype_score
      item.v2_decision        = sis.decision
      item.engine_justification = sis.engine_justification

      const v1Published  = !!obs.signal_id
      const v2Publishes  = sis.decision === 'SIGNAL' || sis.decision === 'WEAK_SIGNAL'
      item.decision_changed = v1Published !== v2Publishes

    } catch (err) {
      item.v2_decision          = err instanceof AIProviderError && err.statusCode === 429
        ? 'RATE_LIMITED' : 'SIS_ERROR'
      item.engine_justification = err instanceof Error ? err.message.slice(0, 200) : String(err)
    }

    results.push(item)
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const sisResults = results.filter(r => r.sis_final !== null)
  const summary = {
    total:            results.length,
    hard_rejected:    results.filter(r => r.hard_rejected).length,
    v2_signal:        results.filter(r => r.v2_decision === 'SIGNAL').length,
    v2_weak_signal:   results.filter(r => r.v2_decision === 'WEAK_SIGNAL').length,
    v2_discard:       results.filter(r => r.v2_decision === 'DISCARD').length,
    errors:           results.filter(r => ['SIS_ERROR', 'RATE_LIMITED', 'UNKNOWN'].includes(r.v2_decision)).length,
    decision_changed: results.filter(r => r.decision_changed).length,
    v1_had_signal:    results.filter(r => r.v1_had_signal).length,
    avg_sis_final:    sisResults.length > 0
      ? parseFloat((sisResults.reduce((s, r) => s + (r.sis_final ?? 0), 0) / sisResults.length).toFixed(2))
      : null,
    avg_human_roles:  sisResults.length > 0
      ? parseFloat((sisResults.reduce((s, r) => s + (r.human_roles_yes ?? 0), 0) / sisResults.length).toFixed(2))
      : null,
    thresholds:       V2_THRESHOLDS,
  }

  // ── Store in engine_simulation_runs ───────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: simRun } = await (supabase as any)
    .from('engine_simulation_runs')
    .insert({
      run_type:        'dry_run',
      observation_ids: observations.map(o => o.id),
      results,
      summary,
      engine_version:  'v2.0',
      status:          'COMPLETE',
      completed_at:    new Date().toISOString(),
    })
    .select('id')
    .single()

  const verdict = summary.decision_changed > 0
    ? `V2 would change ${summary.decision_changed} of ${summary.total} decisions vs V1. Review results before enabling production.`
    : `V2 decisions align with V1 on all ${summary.total} observations. Safe to enable.`

  return NextResponse.json({
    simulation_id: (simRun as { id: string } | null)?.id ?? null,
    summary,
    verdict,
    results,
  })
}
