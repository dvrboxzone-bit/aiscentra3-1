import { NextResponse } from 'next/server'

import { acquireEnrichmentLock, releaseEnrichmentLock } from '@/lib/ai/execution-lock'
import { getModelChain } from '@/lib/ai/models'
import { isAuthorizedCronRequest } from '@/lib/security/cron-guard'
import { createAdminClient } from '@/lib/supabase/server'
import { SIS_SYSTEM_PROMPT, buildSISPrompt } from '@/modules/signals/strategic-score'
import {
  DURABLE_SIS_V1_CLASSIFIER_MAX_TOKENS,
  DURABLE_SIS_V1_CONTROL_ID,
  budgetReservationFor,
} from '@/modules/signals/durable-sis-v1'

export const dynamic = 'force-dynamic'

export async function POST(request: Request): Promise<NextResponse> {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const classifier = getModelChain('classifier')[0]
  if (!classifier) return NextResponse.json({ error: 'Classifier unavailable' }, { status: 503 })

  const db = createAdminClient() as never as {
    rpc: (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>
    from: (table: string) => any // eslint-disable-line @typescript-eslint/no-explicit-any
  }
  const holder = `durable-sis-v1-start:${crypto.randomUUID()}`
  if (!(await acquireEnrichmentLock(db, holder))) {
    return NextResponse.json({ error: 'Enrichment locked' }, { status: 409 })
  }
  try {
    const { data: observation, error: observationError } = await db
      .from('observations')
      .select('id,source_id,title,content')
      .eq('id', DURABLE_SIS_V1_CONTROL_ID)
      .single()
    if (observationError || !observation) {
      return NextResponse.json({ error: 'Control observation unavailable' }, { status: 503 })
    }
    const { data: source } = await db
      .from('sources')
      .select('name,type')
      .eq('id', observation.source_id)
      .single()
    const messages = [
      { role: 'system' as const, content: SIS_SYSTEM_PROMPT },
      {
        role: 'user' as const,
        content: buildSISPrompt(
          observation.title,
          observation.content,
          source?.name ?? 'Unknown Source',
          source?.type ?? '',
        ),
      },
    ]
    const reservation = budgetReservationFor(
      messages,
      classifier,
      DURABLE_SIS_V1_CLASSIFIER_MAX_TOKENS,
    )
    const { data, error } = await db.rpc('start_durable_sis_v1_control', {
      p_provider: classifier.provider,
      p_model: classifier.model,
      p_units: reservation.units,
      p_unit_kind: reservation.unitKind,
    })
    if (error) return NextResponse.json({ error: 'Control start failed' }, { status: 503 })
    return NextResponse.json(data)
  } finally {
    await releaseEnrichmentLock(db, holder)
  }
}
