import { pathToFileURL } from 'node:url'
import {
  AIProviderError,
  callProvider,
  type AIMessage,
  type SafeProviderErrorDetails,
} from '@/lib/ai/client'
import {
  DURABLE_SIS_V1_COMPACT_PARSER_INSTRUCTION,
  DURABLE_SIS_V1_PARSER_MAX_TOKENS,
  buildDurableSisParserPrompt,
  durableSisParserRequestOptions,
} from '@/modules/signals/durable-sis-parser-contract'

const GROQ_120B = { provider: 'groq' as const, model: 'openai/gpt-oss-120b' }
const PROBE_DEADLINE_MS = 55_000

export type GroqParserProbeDiagnostic = {
  http_status: number
  error?: SafeProviderErrorDetails
}

export const SYNTHETIC_PARSER_MESSAGES: AIMessage[] = [
  { role: 'system', content: DURABLE_SIS_V1_COMPACT_PARSER_INSTRUCTION },
  {
    role: 'user',
    content: buildDurableSisParserPrompt({
      title: 'Synthetic compiler benchmark improves deterministic inference throughput',
      content:
        'A synthetic research fixture reports a reproducible throughput improvement in a controlled compiler benchmark. The fixture is artificial and exists only to validate the parser request contract.',
      sourceName: 'Synthetic Research Fixture',
      sourceType: 'research',
      sourceTrustScore: 0.8,
      candidateCategory: 'RESEARCH',
    }),
  },
]

export function safeProbeDiagnostic(error: unknown): GroqParserProbeDiagnostic | null {
  if (!(error instanceof AIProviderError) || error.statusCode < 400 || error.statusCode >= 500) {
    return null
  }

  return {
    http_status: error.statusCode,
    ...(error.safeDetails === undefined ? {} : { error: error.safeDetails }),
  }
}

export async function runGroqParserContractProbe(): Promise<GroqParserProbeDiagnostic> {
  const result = await callProvider(
    GROQ_120B,
    SYNTHETIC_PARSER_MESSAGES,
    {
      maxTokens: DURABLE_SIS_V1_PARSER_MAX_TOKENS,
      temperature: 0,
      ...durableSisParserRequestOptions('groq'),
    },
    Date.now() + PROBE_DEADLINE_MS,
  )

  return { http_status: result.httpStatus }
}

async function main(): Promise<number> {
  if (!process.env['GROQ_API_KEY']) {
    console.error('BLOCKED: GROQ_API_KEY is unavailable')
    return 2
  }

  try {
    console.log(JSON.stringify(await runGroqParserContractProbe()))
    return 0
  } catch (error) {
    const diagnostic = safeProbeDiagnostic(error)
    if (diagnostic) {
      console.log(JSON.stringify(diagnostic))
      return 0
    }

    console.error('BLOCKED: probe did not return a safe HTTP 4xx diagnostic')
    return 2
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().then((exitCode) => {
    process.exitCode = exitCode
  })
}
