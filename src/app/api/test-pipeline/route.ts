/**
 * TEMPORARY — DELETE AFTER USE
 * Full pipeline test on new Supabase account
 */
import { NextResponse } from 'next/server'
export const maxDuration = 60
export async function GET(): Promise<NextResponse> {
  const appUrl     = process.env['NEXT_PUBLIC_APP_URL'] ?? 'https://aiscentra3-1.vercel.app'
  const cronSecret = process.env['CRON_SECRET'] ?? ''
  const headers    = { 'Content-Type': 'application/json', 'x-cron-secret': cronSecret }
  const log: Record<string, unknown> = {}

  // Step 1: Health before
  log['health_before'] = await fetch(`${appUrl}/api/health`).then(r => r.json()).catch(String)

  // Step 2: Collect
  try {
    const r = await fetch(`${appUrl}/api/collect`, { method: 'POST', headers, body: JSON.stringify({}) })
    log['collect'] = await r.json()
  } catch (e) { log['collect_error'] = String(e) }

  // Step 3: Wait 20s
  await new Promise(r => setTimeout(r, 20_000))

  // Step 4: Enrich batch
  try {
    const r = await fetch(`${appUrl}/api/enrich/batch`, { method: 'POST', headers, body: JSON.stringify({}) })
    log['enrich_batch'] = await r.json()
  } catch (e) { log['enrich_error'] = String(e) }

  // Step 5: Health after
  log['health_after'] = await fetch(`${appUrl}/api/health`).then(r => r.json()).catch(String)

  return NextResponse.json({ log })
}
