import { NextResponse } from 'next/server'

import { acquireEnrichmentLock, releaseEnrichmentLock } from '@/lib/ai/execution-lock'
import { getModelChain } from '@/lib/ai/models'
import { isAuthorizedCronRequest } from '@/lib/security/cron-guard'
import { createAdminClient } from '@/lib/supabase/server'
import { SIS_SYSTEM_PROMPT, buildSISPrompt } from '@/modules/signals/strategic-score'
import {
  DURABLE_SIS_V1_CLASSIFIER_MAX_TOKENS,
  budgetReservationFor,
} from '@/modules/signals/durable-sis-v1'

export const dynamic = 'force-dynamic'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

async function readCanaryObservationId(request: Request): Promise<string | null> {
  const payload = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!payload || Array.isArray(payload) || Object.keys(payload).length !== 1) return null
  const observationId = payload['observation_id']
  return typeof observationId === 'string' && UUID_PATTERN.test(observationId)
    ? observationId
    : null
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const observationId = await readCanaryObservationId(request)
  if (!observationId) {
    return NextResponse.json({ error: 'Invalid canary observation' }, { status: 400 })
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
      .eq('id', observationId)
      .single()
    if (observationError || !observation) {
      return NextResponse.json({ error: 'Canary observation unavailable' }, { status: 503 })
    }
    const { data: source, error: sourceError } = await db
      .from('sources')
      .select('name,type,status')
      .eq('id', observation.source_id)
      .single()
    if (sourceError || !source || source.status !== 'ACTIVE') {
      return NextResponse.json({ error: 'Canary source unavailable' }, { status: 503 })
    }
    const messages = [
      { role: 'system' as const, content: SIS_SYSTEM_PROMPT },
      {
        role: 'user' as const,
        content: buildSISPrompt(observation.title, observation.content, source.name, source.type),
      },
    ]
    const reservation = budgetReservationFor(
      messages,
      classifier,
      DURABLE_SIS_V1_CLASSIFIER_MAX_TOKENS,
    )
    const { data, error } = await db.rpc('start_durable_sis_v1_control', {
      p_observation_id: observationId,
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
