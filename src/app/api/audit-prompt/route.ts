/**
 * TEMPORARY — DELETE AFTER USE
 * Prompt quality audit — processes 10 observations and returns results for review
 */
import { NextResponse }     from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { buildEnrichmentPrompt, EnrichmentOutputSchema, ENRICHMENT_SYSTEM_PROMPT } from '@/modules/signals/enrichment-prompt'
import { callProviderJSON } from '@/lib/ai/client'
import type { ObservationRow } from '@/modules/observations/queries'

export const maxDuration = 60
export const dynamic     = 'force-dynamic'

export async function GET(): Promise<NextResponse> {
  const supabase = createAdminClient()

  // Fetch 10 unprocessed observations ordered randomly
  const { data: rows } = await supabase
    .from('observations')
    .select('*')
    .eq('processed', false)
    .is('processing_error', null)
    .order('collected_at', { ascending: false })
    .limit(10)

  if (!rows || rows.length === 0) {
    return NextResponse.json({ error: 'No unprocessed observations found' })
  }

  const results = []
  const model = { provider: 'groq' as const, model: 'llama-3.3-70b-versatile' }

  for (const obs of rows as ObservationRow[]) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: source } = await (supabase as any)
      .from('sources')
      .select('name, trust_score, source_type')
      .eq('id', obs.source_id)
      .single()

    const prompt = buildEnrichmentPrompt({
      title:             obs.title,
      content:           obs.content,
      sourceName:        (source?.name as string) ?? 'Unknown',
      sourceUrl:         '',
      sourceTrustScore:  (source?.trust_score as number) ?? 0.5,
      candidateCategory: 'RESEARCH',
      recentSignalTitles: [],
    })

    try {
      const result = await callProviderJSON(model, [
        { role: 'system', content: ENRICHMENT_SYSTEM_PROMPT },
        { role: 'user',   content: prompt },
      ], EnrichmentOutputSchema, { temperature: 0, maxTokens: 1024 })

      results.push({
        id:          obs.id,
        title:       obs.title,
        source:      source?.name ?? 'Unknown',
        ok:          true,
        category:    result.category,
        description: result.description,
        entities:    result.entities,
        scores: {
          signal:      result.impact_factor + result.novelty_factor + result.strategic_factor,
          authority:   result.authority_factor,
          novelty:     result.novelty_factor,
        },
        marketing:   result.is_marketing,
      })
    } catch (err) {
      results.push({
        id:    obs.id,
        title: obs.title,
        ok:    false,
        error: err instanceof Error ? err.message.slice(0, 200) : String(err),
      })
    }

    // 6s delay between requests
    await new Promise(r => setTimeout(r, 6_000))
  }

  const ok    = results.filter(r => r.ok).length
  const fails = results.filter(r => !r.ok).length

  return NextResponse.json({ total: results.length, ok, fails, results })
}
