import { z } from 'zod'
import type { AIOptions } from '@/lib/ai/client'
import type { ProviderName } from '@/lib/ai/config'
import { EVIDENCE_PROCESSING_CONTRACT_V1 } from './primary-evidence-policy'

const TITLE_MAX_CHARS = 80
const DESCRIPTION_MAX_CHARS = 512
const ENTITY_NAME_MAX_CHARS = 48
const ENTITY_MAX_ITEMS = 6
const NOTE_MAX_CHARS = 80

const noControlCharacters = (value: string): boolean => !/[\u0000-\u001f\u007f]/u.test(value)

function boundedText(min: number, max: number): z.ZodEffects<z.ZodString, string, string> {
  return z
    .string()
    .min(min)
    .max(max)
    .refine(noControlCharacters, 'Control characters are not allowed')
}

const DurableEntityTypeSchema = z.preprocess(
  (value) => {
    const knownMismaps = new Set(['BENCHMARK', 'METHOD', 'PLATFORM', 'OPEN_SOURCE'])
    return typeof value === 'string' && knownMismaps.has(value) ? 'UNKNOWN' : value
  },
  z.enum([
    'COMPANY',
    'MODEL',
    'RESEARCH_PAPER',
    'PERSON',
    'PRODUCT',
    'AGENT',
    'ORGANIZATION',
    'TECHNOLOGY',
    'INFRASTRUCTURE',
    'REGULATION',
    'INVESTMENT',
    'DATASET',
    'TOOL',
    'UNKNOWN',
  ]),
)

/** Durable-only parser contract: bounded, strict, and intentionally compact. */
export const DurableSisParserOutputSchema = z
  .object({
    title: boundedText(10, TITLE_MAX_CHARS),
    description: boundedText(50, DESCRIPTION_MAX_CHARS),
    category: z.enum([
      'RESEARCH',
      'MODELS',
      'COMPANIES',
      'INFRASTRUCTURE',
      'OPEN_SOURCE',
      'FUNDING',
      'REGULATION',
      'AGENTS',
      'HARDWARE',
    ]),
    impact_factor: z.number().int().min(0).max(10),
    actor_factor: z.number().int().min(0).max(10),
    novelty_factor: z.number().int().min(0).max(10),
    verifiability_factor: z.number().int().min(0).max(10),
    strategic_factor: z.number().int().min(0).max(10),
    authority_factor: z.number().int().min(0).max(10),
    corroboration_factor: z.number().int().min(0).max(10),
    specificity_factor: z.number().int().min(0).max(10),
    category_confidence_factor: z.number().int().min(0).max(10),
    entities: z
      .array(
        z
          .object({
            name: boundedText(1, ENTITY_NAME_MAX_CHARS),
            type: DurableEntityTypeSchema,
          })
          .strict(),
      )
      .max(ENTITY_MAX_ITEMS),
    is_duplicate: z.boolean(),
    duplicate_note: z.union([boundedText(0, NOTE_MAX_CHARS), z.null()]),
    is_marketing: z.boolean(),
    novelty_prior_example: z.union([boundedText(0, NOTE_MAX_CHARS), z.null()]),
  })
  .strict()

export type DurableSisParserOutput = z.infer<typeof DurableSisParserOutputSchema>

const CATEGORIES = [
  'RESEARCH',
  'MODELS',
  'COMPANIES',
  'INFRASTRUCTURE',
  'OPEN_SOURCE',
  'FUNDING',
  'REGULATION',
  'AGENTS',
  'HARDWARE',
] as const

const ENTITY_TYPES = [
  'COMPANY',
  'MODEL',
  'RESEARCH_PAPER',
  'PERSON',
  'PRODUCT',
  'AGENT',
  'ORGANIZATION',
  'TECHNOLOGY',
  'INFRASTRUCTURE',
  'REGULATION',
  'INVESTMENT',
  'DATASET',
  'TOOL',
  'UNKNOWN',
] as const

const FACTOR_PROPERTIES = Object.fromEntries(
  [
    'impact_factor',
    'actor_factor',
    'novelty_factor',
    'verifiability_factor',
    'strategic_factor',
    'authority_factor',
    'corroboration_factor',
    'specificity_factor',
    'category_confidence_factor',
  ].map((name) => [name, { type: 'integer', minimum: 0, maximum: 10 }]),
)

/** Provider-facing schema mirrors the strict Zod boundary without optional keys. */
export const DURABLE_SIS_V1_PARSER_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string', minLength: 10, maxLength: TITLE_MAX_CHARS },
    description: { type: 'string', minLength: 50, maxLength: DESCRIPTION_MAX_CHARS },
    category: { type: 'string', enum: CATEGORIES },
    ...FACTOR_PROPERTIES,
    entities: {
      type: 'array',
      maxItems: ENTITY_MAX_ITEMS,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', minLength: 1, maxLength: ENTITY_NAME_MAX_CHARS },
          type: { type: 'string', enum: ENTITY_TYPES },
        },
        required: ['name', 'type'],
      },
    },
    is_duplicate: { type: 'boolean' },
    duplicate_note: { type: ['string', 'null'], maxLength: NOTE_MAX_CHARS },
    is_marketing: { type: 'boolean' },
    novelty_prior_example: { type: ['string', 'null'], maxLength: NOTE_MAX_CHARS },
  },
  required: [
    'title',
    'description',
    'category',
    ...Object.keys(FACTOR_PROPERTIES),
    'entities',
    'is_duplicate',
    'duplicate_note',
    'is_marketing',
    'novelty_prior_example',
  ],
} as const

/**
 * Groq GPT-OSS supports strict constrained decoding. Cloudflare accepts its
 * provider-native JSON-schema shape. Other providers still get JSON object
 * mode plus the same local Zod validation.
 */
export function durableSisParserRequestOptions(
  provider: ProviderName,
): Pick<AIOptions, 'responseFormat' | 'reasoningEffort'> {
  const responseFormat =
    provider === 'groq'
      ? {
          type: 'json_schema' as const,
          json_schema: {
            name: 'durable_sis_v1_parser',
            strict: true,
            schema: DURABLE_SIS_V1_PARSER_JSON_SCHEMA,
          },
        }
      : provider === 'cloudflare'
        ? {
            type: 'json_schema' as const,
            json_schema: DURABLE_SIS_V1_PARSER_JSON_SCHEMA,
          }
        : { type: 'json_object' as const }

  return { responseFormat, reasoningEffort: 'low' }
}

export const DURABLE_SIS_V1_COMPACT_PARSER_INSTRUCTION = `You are an evidence-bound signal parser, not a conversational assistant.
Return exactly one minified JSON object that matches the supplied schema. Never emit markdown, analysis, reasoning, commentary, or extra keys.
${EVIDENCE_PROCESSING_CONTRACT_V1}
Use only facts and named entities present in SOURCE, TITLE, and CONTENT. Never invent numbers, benchmarks, actors, adoption, or corroboration.
Write a factual 10-80 character title without hedging. Write a 50-512 character description in 2-3 short active-voice sentences; state what changed, why it matters, and only evidence-backed uncertainty. When EVIDENCE_POLICY is eligible, the first sentence MUST begin with its exact required_attribution phrase. Do not begin with I, We, or Our.
All nine factors are integers 0-10 and must not be inflated. One supplied source means corroboration_factor=2. Source type and trust may inform authority_factor but can never grant primary status or independence. If novelty exceeds 7, novelty_prior_example must name a concrete prior example from the supplied evidence; otherwise cap novelty_factor at 7 and use null.
Extract at most 6 specific entities. Set is_marketing only when promotion is the primary purpose. With no supplied comparison titles, set is_duplicate=false and duplicate_note=null.
All fields are required. Notes are null or at most 80 characters.`

function promptLine(value: string, maxChars: number): string {
  return value
    .replace(/[\u0000-\u001f\u007f]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, maxChars)
}

export function buildDurableSisParserPrompt(input: {
  title: string
  content: string
  sourceName: string
  sourceType: string
  sourceTrustScore: number
  candidateCategory: string
  evidencePolicy?: string
}): string {
  return `${input.evidencePolicy ?? 'EVIDENCE_POLICY: eligible=false; reason=NOT_EVALUATED'}
<UNTRUSTED_SOURCE>
SOURCE: ${promptLine(input.sourceName, 120)} | type=${promptLine(input.sourceType, 48)} | trust=${input.sourceTrustScore} | candidate_category=${promptLine(input.candidateCategory, 32)}
TITLE: ${promptLine(input.title, 300)}
CONTENT: ${promptLine(input.content, 600)}
</UNTRUSTED_SOURCE>`
}

/**
 * Maximum contract witness. U+0800 uses three UTF-8 bytes per JavaScript code
 * unit, making this stricter than the expected English production output.
 */
export function maximalDurableParserOutput(): DurableSisParserOutput {
  const wide = '\u0800'
  return {
    title: wide.repeat(TITLE_MAX_CHARS),
    description: wide.repeat(DESCRIPTION_MAX_CHARS),
    category: 'INFRASTRUCTURE',
    impact_factor: 10,
    actor_factor: 10,
    novelty_factor: 10,
    verifiability_factor: 10,
    strategic_factor: 10,
    authority_factor: 10,
    corroboration_factor: 10,
    specificity_factor: 10,
    category_confidence_factor: 10,
    entities: Array.from({ length: ENTITY_MAX_ITEMS }, () => ({
      name: wide.repeat(ENTITY_NAME_MAX_CHARS),
      type: 'INFRASTRUCTURE' as const,
    })),
    is_duplicate: false,
    duplicate_note: wide.repeat(NOTE_MAX_CHARS),
    is_marketing: false,
    novelty_prior_example: wide.repeat(NOTE_MAX_CHARS),
  }
}

function roundUp(value: number, multiple: number): number {
  return Math.ceil(value / multiple) * multiple
}

const maximumContractBytes = Buffer.byteLength(JSON.stringify(maximalDurableParserOutput()), 'utf8')
const conservativeContractTokens = Math.ceil(maximumContractBytes / 2)

/**
 * Derived from the maximum valid compact JSON payload with 10% envelope
 * headroom, rounded to a provider-friendly 256-token boundary.
 */
export const DURABLE_SIS_V1_PARSER_MAX_TOKENS = roundUp(
  Math.ceil(conservativeContractTokens * 1.1),
  256,
)
