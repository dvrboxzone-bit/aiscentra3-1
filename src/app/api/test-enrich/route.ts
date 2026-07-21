/**
 * TEMPORARY DIAGNOSTIC — DELETE AFTER USE
 * Traces ONE observation through full pipeline with detailed logging
 */
import { NextResponse }               from 'next/server'
import { createAdminClient }          from '@/lib/supabase/server'
import { buildEnrichmentPrompt, EnrichmentOutputSchema, ENRICHMENT_SYSTEM_PROMPT } from '@/modules/signals/enrichment-prompt'
import { callProviderJSON, AIProviderError } from '@/lib/ai/client'
import type { ObservationRow }        from '@/modules/observations/queries'

export const maxDuration = 60
export const dynamic     = 'force-dynamic'

export async function GET(): Promise<NextResponse> {
  const supabase = createAdminClient()
  const trace: Record<string, unknown> = {}

  // Step 1: Fetch ONE unprocessed observation
  const { data: rows } = await supabase
    .from('observations')
    .select('*')
    .eq('processed', false)
    .is('processing_error', null)
    .order('collected_at', { ascending: true })
    .limit(1)

  const obs = rows?.[0] as ObservationRow | undefined
  if (!obs) return NextResponse.json({ error: 'No unprocessed observations' })

  trace['observation_id']    = obs.id
  trace['observation_title'] = obs.title
  trace['source_id']         = obs.source_id

  // Step 2: Fetch source
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: source } = await (supabase as any)
    .from('sources')
    .select('name, trust_score, source_type, url')
    .eq('id', obs.source_id)
    .single()

  trace['source'] = source

  // Step 3: Build prompt
  const prompt = buildEnrichmentPrompt({
    title:               obs.title,
    content:             obs.content,
    sourceName:          (source?.name as string) ?? 'Unknown',
    sourceUrl:           (source?.url as string) ?? '',
    sourceTrustScore:    (source?.trust_score as number) ?? 0.5,
    candidateCategory:   'RESEARCH',
    recentSignalTitles:  [],
  })

  trace['prompt_length_chars'] = prompt.length
  trace['system_prompt_chars'] = ENRICHMENT_SYSTEM_PROMPT.length

  // Step 4: ONE raw LLM call — no fallback, no retry
  const model = { provider: 'groq' as const, model: process.env['AI_PRIMARY_MODEL'] ?? 'llama-3.3-70b-versatile' }
  let rawContent: string | null = null

  try {
    const result = await callProviderJSON(model, [
      { role: 'system', content: ENRICHMENT_SYSTEM_PROMPT },
      { role: 'user',   content: prompt },
    ], EnrichmentOutputSchema, { temperature: 0, maxTokens: 600 })

    trace['llm_status']        = 'HTTP 200'
    trace['llm_result']        = result
    trace['validation_passed'] = true

  } catch (err) {
    trace['llm_status']  = err instanceof AIProviderError ? `HTTP ${err.statusCode}` : 'ERROR'
    trace['llm_error']   = err instanceof Error ? err.message.slice(0, 500) : String(err)
    trace['validation_passed'] = false

    // If 200 but validation failed — show raw
    if (rawContent) trace['raw_content'] = rawContent
  }

  return NextResponse.json({ trace })
}
