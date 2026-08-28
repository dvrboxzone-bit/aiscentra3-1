import { z } from 'zod'

const TITLE_MAX_CHARS = 80
const DESCRIPTION_MAX_CHARS = 400
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

export const DURABLE_SIS_V1_COMPACT_PARSER_INSTRUCTION = `Return exactly one minified JSON object and nothing else. Do not include markdown, analysis, or extra keys. Hard limits: title 10-80 characters; description 50-400 characters; at most 6 entities; each entity name at most 48 characters; duplicate_note and novelty_prior_example must be null or at most 80 characters.`

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
