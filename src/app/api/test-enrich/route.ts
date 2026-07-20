/**
 * TEMPORARY — DELETE AFTER USE
 * Step 2: enrich batch only
 */
import { NextResponse } from 'next/server'
export const maxDuration = 60
export async function GET(): Promise<NextResponse> {
  const appUrl     = process.env['NEXT_PUBLIC_APP_URL'] ?? 'https://aiscentra3-1.vercel.app'
  const cronSecret = process.env['CRON_SECRET'] ?? ''
  const headers    = { 'Content-Type': 'application/json', 'x-cron-secret': cronSecret }

  let enrich: unknown = null
  try {
    const r = await fetch(`${appUrl}/api/enrich/batch`, { method: 'POST', headers, body: '{}' })
    enrich = await r.json()
  } catch (e) { enrich = String(e) }

  const after = await fetch(`${appUrl}/api/health`).then(r => r.json()).catch(String)

  return NextResponse.json({ enrich, health_after: after })
}
