/**
 * TEMPORARY — DELETE AFTER USE
 * Step 1: collect only
 */
import { NextResponse } from 'next/server'
export const maxDuration = 30
export async function GET(): Promise<NextResponse> {
  const appUrl     = process.env['NEXT_PUBLIC_APP_URL'] ?? 'https://aiscentra3-1.vercel.app'
  const cronSecret = process.env['CRON_SECRET'] ?? ''
  const headers    = { 'Content-Type': 'application/json', 'x-cron-secret': cronSecret }

  const before = await fetch(`${appUrl}/api/health`).then(r => r.json()).catch(String)

  let collect: unknown = null
  try {
    const r = await fetch(`${appUrl}/api/collect`, { method: 'POST', headers, body: '{}' })
    collect = await r.json()
  } catch (e) { collect = String(e) }

  return NextResponse.json({ health_before: before, collect, next: `${appUrl}/api/test-enrich` })
}
