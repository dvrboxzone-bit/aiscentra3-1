/**
 * TEMPORARY — DELETE AFTER USE
 * Reads existing signals for quality audit
 */
import { NextResponse }      from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<NextResponse> {
  const supabase = createAdminClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: signals, error } = await (supabase as any)
    .from('signals')
    .select('id, title, description, category, signal_score, confidence_score, entity_ids, impact_factor, actor_factor, novelty_factor, authority_factor, strategic_factor, metadata')
    .eq('status', 'ACTIVE')
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ count: signals?.length ?? 0, signals })
}
