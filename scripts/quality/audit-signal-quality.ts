#!/usr/bin/env node
/**
 * Read-only Signal Quality Foundation dry run.
 *
 * Required environment variables:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * The script only performs paginated SELECTs. It deliberately does not know
 * how to insert/update/delete, apply migrations, or approve a Signal.
 */
import { createClient } from '@supabase/supabase-js'
import { buildSignalQualityAudit } from '../../src/modules/signals/quality'
import type { SignalStatus } from '../../src/types/database'

const PAGE_SIZE = 1_000

async function main(): Promise<void> {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL']
  const serviceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY']

  if (!url || !serviceRoleKey) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for the read-only audit',
    )
  }

  const supabase = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const rows: Array<{ status: SignalStatus }> = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('signals')
      .select('status')
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)

    if (error) throw new Error(`Signal quality audit SELECT failed: ${error.message}`)

    const page = (data ?? []) as Array<{ status: SignalStatus }>
    rows.push(...page)
    if (page.length < PAGE_SIZE) break
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        mode: 'planned-backfill-read-only',
        generatedAt: new Date().toISOString(),
        ...buildSignalQualityAudit(rows),
      },
      null,
      2,
    )}\n`,
  )
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
