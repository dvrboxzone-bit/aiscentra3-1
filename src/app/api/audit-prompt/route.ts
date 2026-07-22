/**
 * TEMPORARY — DELETE AFTER USE
 * Prompt quality audit — 5 observations, no inter-request delay
 */
import { NextResponse }      from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { buildEnrichmentPrompt, EnrichmentOutputSchema, ENRICHMENT_SYSTEM_PROMPT } from '@/modules/signals/enrichment-prompt'
import { callProviderJSON }  from '@/lib/ai/client'
import type { ObservationRow } from '@/modules/observations/queries'

export const maxDuration = 60
export const dynamic     = 'force-dynamic'

export async function GET(): Promise<NextResponse> {
  const supabase = createAdminClient()

  const { data: rows } = await supabase
    .from('observations')
    .select('*')
    .eq('processed', false)
    .is('processing_error', null)
    .order('collected_at', { ascending: false })
    .limit(5)

  if (!rows || rows.length === 0) {
    return NextResponse.json({ error: 'No unprocessed observations' })
  }

  const model   = { provider: 'groq' as const, model: 'llama-3.3-70b-versatile' }
  const results = []

  for (const obs of rows as ObservationRow[]) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: source } = await (supabase as any)
      .from('sources').select('name, trust_score').eq('id', obs.source_id).single()

    const prompt = buildEnrichmentPrompt({
      title: obs.title, content: obs.content,
      sourceName: (source?.name as string) ?? 'Unknown', sourceUrl: '',
      sourceTrustScore: (source?.trust_score as number) ?? 0.5,
      candidateCategory: 'RESEARCH', recentSignalTitles: [],
    })

    try {
      const r = await callProviderJSON(model,
        [{ role: 'system', content: ENRICHMENT_SYSTEM_PROMPT }, { role: 'user', content: prompt }],
        EnrichmentOutputSchema, { temperature: 0, maxTokens: 1024 })
      results.push({
        ok: true, title: obs.title, source: source?.name ?? '?',
        category: r.category, authority: r.authority_factor,
        novelty: r.novelty_factor, is_marketing: r.is_marketing,
        description: r.description,
        entities: r.entities?.map((e: {name: string; type: string}) => `${e.name}(${e.type})`),
      })
    } catch (err) {
      results.push({ ok: false, title: obs.title,
        error: err instanceof Error ? err.message.slice(0, 150) : String(err) })
    }
  }

  return NextResponse.json({
    ok: results.filter(r => r.ok).length,
    fail: results.filter(r => !r.ok).length,
    results,
  })
}
