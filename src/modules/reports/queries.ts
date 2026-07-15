import { createClient } from '@/lib/supabase/server'
import type { Report, ReportType } from '@/types/database'

export async function getReports(type?: ReportType, limit = 20): Promise<Report[]> {
  const supabase = await createClient()

  let query = supabase
    .from('reports')
    .select('*')
    .not('published_at', 'is', null)
    .order('published_at', { ascending: false })
    .limit(limit)

  if (type) {
    query = query.eq('report_type', type)
  }

  const { data, error } = await query

  if (error) {
    console.error('[reports/queries] getReports error:', error.message)
    return []
  }

  return (data ?? []) as Report[]
}

export async function getReportById(id: string): Promise<Report | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('reports')
    .select('*')
    .eq('id', id)
    .not('published_at', 'is', null)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null
    console.error('[reports/queries] getReportById error:', error.message)
    return null
  }

  return data as Report
}
