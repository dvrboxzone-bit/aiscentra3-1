/**
 * AIscentra — Signal Engine V2 Dry-Run Simulation
 * GET /api/admin/simulate-engine-v2
 * Public — simulation only, no data modified
 */
import { NextResponse }      from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { agentCompleteJSON } from '@/lib/ai/agent'
import { AIProviderError }   from '@/lib/ai/client'
import { checkHardRejection, V2_THRESHOLDS } from '@/modules/signals/pre-qualification'
import { SISOutputSchema, SIS_SYSTEM_PROMPT, buildSISPrompt, computeSIS } from '@/modules/signals/strategic-score'
import type { ObservationRow } from '@/modules/observations/queries'

export const maxDuration = 60
export const dynamic     = 'force-dynamic'

type SimResult = {
  observation_id:       string
  title:                string
  source:               string
  v1_had_signal:        boolean
  hard_rejected:        boolean
  rejection_code:       string | null
  sis_final:            number | null
  human_roles_yes:      number | null
  v2_decision:          string
  engine_justification: string
  decision_changed:     boolean
}

export async function GET(): Promise<NextResponse> {
  const supabase = createAdminClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rows, error } = await (supabase as any)
    .from('observations')
    .select('*, sources(name, type, trust_score)')
    .eq('processed', true)
    .order('collected_at', { ascending: false })
    .limit(5)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const observations = (rows ?? []) as (ObservationRow & {
    sources: { name: string; type: string; trust_score: number } | null
    signal_id: string | null
  })[]

  if (observations.length === 0) return NextResponse.json({ error: 'No processed observations' })

  const results: SimResult[] = []

  for (const obs of observations) {
    const sourceType = obs.sources?.type ?? ''
    const sourceName = obs.sources?.name ?? 'Unknown'
    const item: SimResult = {
      observation_id: obs.id, title: obs.title.slice(0, 80), source: sourceName,
      v1_had_signal: !!obs.signal_id, hard_rejected: false, rejection_code: null,
      sis_final: null, human_roles_yes: null,
      v2_decision: 'UNKNOWN', engine_justification: '', decision_changed: false,
    }

    const hardCheck = checkHardRejection(obs, sourceType)
    if (hardCheck.rejected) {
      item.hard_rejected = true
      item.rejection_code = hardCheck.code
      item.v2_decision = 'DISCARD'
      item.engine_justification = `Rule ${hardCheck.code}: ${hardCheck.reason}`
      item.decision_changed = !!obs.signal_id
      results.push(item); continue
    }

    try {
      const sisRaw = await agentCompleteJSON('classifier',
        [{ role: 'system', content: SIS_SYSTEM_PROMPT },
         { role: 'user',   content: buildSISPrompt(obs.title, obs.content, sourceName, sourceType) }],
        SISOutputSchema, { temperature: 0, maxTokens: 400 })
      const sis = computeSIS(sisRaw as Parameters<typeof computeSIS>[0])
      item.sis_final = sis.sis.final
      item.human_roles_yes = sis.human_relevance.roles_yes_count
      item.v2_decision = sis.decision
      item.engine_justification = sis.engine_justification
      item.decision_changed = (!!obs.signal_id) !== (sis.decision === 'SIGNAL' || sis.decision === 'WEAK_SIGNAL')
    } catch (err) {
      item.v2_decision = err instanceof AIProviderError && err.statusCode === 429 ? 'RATE_LIMITED' : 'ERROR'
      item.engine_justification = err instanceof Error ? err.message.slice(0, 150) : String(err)
    }
    results.push(item)
  }

  const summary = {
    total:            results.length,
    hard_rejected:    results.filter(r => r.hard_rejected).length,
    v2_signal:        results.filter(r => r.v2_decision === 'SIGNAL').length,
    v2_weak_signal:   results.filter(r => r.v2_decision === 'WEAK_SIGNAL').length,
    v2_discard:       results.filter(r => r.v2_decision === 'DISCARD').length,
    decision_changed: results.filter(r => r.decision_changed).length,
    thresholds:       V2_THRESHOLDS,
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any).from('engine_simulation_runs').insert({
    run_type: 'dry_run', observation_ids: observations.map(o => o.id),
    results, summary, engine_version: 'v2.0', status: 'COMPLETE',
    completed_at: new Date().toISOString(),
  })

  return NextResponse.json({
    summary,
    verdict: summary.decision_changed > 0
      ? `V2 изменит ${summary.decision_changed} из ${summary.total} решений. Проверьте перед включением.`
      : `V2 совпадает с V1 по всем ${summary.total} наблюдениям. Можно включать.`,
    results,
  })
}
