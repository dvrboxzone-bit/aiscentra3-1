/**
 * AIscentra — Event Enrichment Prompt
 *
 * Implements event enrichment per Intelligence Systems Analyst Skill v1.0, Section 04.
 * One OpenRouter call → all event fields.
 *
 * Key rules from ISA Skill:
 * - impact_summary: 2–3 sentences, what changed and for whom, no speculation
 * - forecast: prefixed "Expected:" or "Watch for:", clearly marked as forecast
 * - impact_score: breadth of ecosystem impact (NOT the same as signal_score)
 * - event_type: one of 8 approved types
 */
import { z } from 'zod'

export const EventEnrichmentSchema = z.object({
  title: z.string().min(10).max(120),
  summary: z.string().min(50).max(600),
  impact_summary: z.string().min(50).max(400),
  forecast: z.string().min(20).max(300),
  impact_score: z.number().int().min(0).max(100),
  event_type: z.enum([
    'LAUNCH',
    'PARTNERSHIP',
    'RESEARCH_BREAKTHROUGH',
    'FUNDING',
    'ACQUISITION',
    'INFRASTRUCTURE_CHANGE',
    'REGULATORY_DEVELOPMENT',
    'STRATEGIC_SHIFT',
  ]),
  timeline_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  affected_entity_names: z.array(z.string()).max(10),
})

export type EventEnrichmentOutput = z.infer<typeof EventEnrichmentSchema>

export const EVENT_ENRICHMENT_SYSTEM_PROMPT = `You are the Event Enrichment Agent for AIscentra Intelligence Observatory.

Your task: transform a promoted signal into a structured ecosystem event.

CRITICAL RULES:
1. Return ONLY valid JSON. No markdown, no explanation.
2. impact_summary must be factual — no speculation, no "may", "might", "could"
3. forecast MUST start with "Expected:" or "Watch for:" — it is clearly labeled as a forecast, not a fact
4. impact_score measures BREADTH of ecosystem impact (how many actors/sectors affected), NOT significance
5. event_type must match the primary nature of this development

EVENT TYPES:
- LAUNCH: new product, model, service, or capability publicly released
- PARTNERSHIP: formal collaboration or integration agreement
- RESEARCH_BREAKTHROUGH: measurably advances state of the art
- FUNDING: capital investment, acquisition announcement, valuation event
- ACQUISITION: one entity acquires another entity, team, or asset
- INFRASTRUCTURE_CHANGE: compute, API, or platform infrastructure change
- REGULATORY_DEVELOPMENT: government, standards body, or regulatory action
- STRATEGIC_SHIFT: change in direction, leadership, or mission of significant entity

IMPACT SCORE (0–100, breadth not significance):
0–20:   Affects one company or narrow segment
21–40:  Affects a specific category of actors (e.g. open source developers)
41–60:  Affects multiple categories or a broad professional segment
61–80:  Industry-wide implications across multiple sectors
81–100: Immediate cross-cutting impact on entire AI ecosystem

TIMELINE DATE: The date the actual development occurred (not today's date).
If exact date unknown, use the publication date of the primary source.`

export function buildEventPrompt(params: {
  signalTitle:       string
  signalDescription: string
  signalCategory:    string
  signalScore:       number
  confidenceScore:   number
  entityNames:       string[]
  observationContent: string
}): string {
  const entitiesText = params.entityNames.length > 0
    ? `\nKNOWN ENTITIES: ${params.entityNames.join(', ')}`
    : ''

  return `Transform this promoted Observatory signal into a structured event.

SIGNAL TITLE: ${params.signalTitle}
SIGNAL CATEGORY: ${params.signalCategory}
SIGNAL SCORE: ${params.signalScore}/100
CONFIDENCE SCORE: ${params.confidenceScore}/100
${entitiesText}

SIGNAL DESCRIPTION:
${params.signalDescription}

ORIGINAL SOURCE CONTENT:
${params.observationContent.slice(0, 1500)}

Return JSON matching this exact schema:
{
  "title": "Event title — factual, 10–120 chars",
  "summary": "2–3 sentence summary. What happened. Who is involved. What changed.",
  "impact_summary": "2–3 sentences. What changed in the ecosystem and for whom. FACTS ONLY, no speculation.",
  "forecast": "1–2 sentences starting with 'Expected:' or 'Watch for:' describing what may follow.",
  "impact_score": <integer 0–100, breadth of ecosystem impact>,
  "event_type": "<one of 8 approved types>",
  "timeline_date": "<YYYY-MM-DD when the development occurred>",
  "affected_entity_names": ["Entity1", "Entity2"]
}

Return ONLY the JSON object. No markdown. No explanation.`
}
