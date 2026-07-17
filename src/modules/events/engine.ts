/**
 * AIscentra — Event Engine
 *
 * Transforms a promoted signal into an enriched Event.
 * Per Intelligence Systems Analyst Skill v1.0, Section 04.
 *
 * Flow:
 * Signal (PROMOTED) → Enrich → Validate → Create Event → Mark Signal PROMOTED
 */
import { completeJSON } from '@/lib/openrouter/client'
import { createAdminClient } from '@/lib/supabase/server'
import {
  EventEnrichmentSchema,
  EVENT_ENRICHMENT_SYSTEM_PROMPT,
  buildEventPrompt,
} from './event-prompt'
import { markSignalPromoted } from './promotion'
import type { Signal } from '@/types/database'

export interface EventEngineResult {
  signalId: string
  outcome: 'event_created' | 'rejected_duplicate' | 'error'
  eventId?: string
  reason?: string
}

export async function processSignalIntoEvent(signal: Signal): Promise<EventEngineResult> {
  const supabase = createAdminClient()

  // ── Guard: check for existing event on this signal ────────────────────────
  const { data: existing } = await supabase
    .from('events')
    .select('id')
    .eq('signal_id', signal.id)
    .single()

  if (existing?.id) {
    return {
      signalId: signal.id,
      outcome:  'rejected_duplicate',
      reason:   `Event already exists for signal ${signal.id}`,
    }
  }

  // ── Fetch entity names for context ────────────────────────────────────────
  let entityNames: string[] = []
  if (signal.entity_ids.length > 0) {
    const { data: entities } = await supabase
      .from('entities')
      .select('name')
      .in('id', signal.entity_ids)
    entityNames = (entities ?? []).map((e: { name: string }) => e.name)
  }

  // ── Fetch original observation content ────────────────────────────────────
  let observationContent = signal.description  // fallback
  if (signal.observation_ids.length > 0) {
    const { data: obs } = await supabase
      .from('observations')
      .select('content')
      .eq('id', signal.observation_ids[0])
      .single()
    if (obs?.content) observationContent = obs.content as string
  }

  // ── AI Enrichment ─────────────────────────────────────────────────────────
  const prompt = buildEventPrompt({
    signalTitle:        signal.title,
    signalDescription:  signal.description,
    signalCategory:     signal.category,
    signalScore:        signal.signal_score,
    confidenceScore:    signal.confidence_score,
    entityNames,
    observationContent,
  })

  let enriched
  try {
    enriched = await completeJSON(
      [
        { role: 'system', content: EVENT_ENRICHMENT_SYSTEM_PROMPT },
        { role: 'user',   content: prompt },
      ],
      EventEnrichmentSchema,
      { temperature: 0, maxTokens: 1000 },
    )
  } catch (err) {
    return {
      signalId: signal.id,
      outcome:  'error',
      reason:   err instanceof Error ? err.message : 'Enrichment failed',
    }
  }

  // ── Validate forecast framing ─────────────────────────────────────────────
  if (
    !enriched.forecast.startsWith('Expected:') &&
    !enriched.forecast.startsWith('Watch for:')
  ) {
    // Fix it rather than reject — prepend the required prefix
    enriched = {
      ...enriched,
      forecast: `Expected: ${enriched.forecast}`,
    }
  }

  // ── Resolve affected entity IDs ───────────────────────────────────────────
  const affectedEntityIds: string[] = [...signal.entity_ids]

  for (const name of enriched.affected_entity_names) {
    const canonicalName = name
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim()

    const { data: entity } = await supabase
      .from('entities')
      .select('id')
      .eq('canonical_name', canonicalName)
      .single()

    if (entity?.id && !affectedEntityIds.includes(entity.id as string)) {
      affectedEntityIds.push(entity.id as string)
    }
  }

  // ── Create Event record ───────────────────────────────────────────────────
  const { data: event, error: eventError } = await supabase
    .from('events')
    .insert({
      signal_id:           signal.id,
      title:               enriched.title,
      summary:             enriched.summary,
      impact_summary:      enriched.impact_summary,
      forecast:            enriched.forecast,
      forecast_outcome:    'UNRESOLVED',
      impact_score:        enriched.impact_score,
      event_type:          enriched.event_type,
      timeline_date:       enriched.timeline_date,
      affected_entity_ids: affectedEntityIds,
      manual_override:     false,
      metadata: {
        enrichment_model: process.env['OPENROUTER_MODEL'] ?? 'anthropic/claude-haiku-4-5',
        enriched_at:      new Date().toISOString(),
        source_signal_score:     signal.signal_score,
        source_confidence_score: signal.confidence_score,
      },
    })
    .select('id')
    .single()

  if (eventError || !event?.id) {
    return {
      signalId: signal.id,
      outcome:  'error',
      reason:   `Event insert failed: ${eventError?.message ?? 'unknown'}`,
    }
  }

  // ── Mark signal as PROMOTED ───────────────────────────────────────────────
  await markSignalPromoted(signal.id, event.id as string)

  console.log(`[event-engine] Signal ${signal.id} → Event ${event.id as string}`)

  return {
    signalId: signal.id,
    outcome:  'event_created',
    eventId:  event.id as string,
  }
}
