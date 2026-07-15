import { createClient } from '@/lib/supabase/server'
import type { Event, EventType } from '@/types/database'

export interface EventFilters {
  eventType?: EventType
  limit?: number
}

export async function getEvents(filters: EventFilters = {}): Promise<Event[]> {
  const supabase = await createClient()

  let query = supabase
    .from('events')
    .select('*')
    .order('timeline_date', { ascending: false })

  if (filters.eventType) {
    query = query.eq('event_type', filters.eventType)
  }

  if (filters.limit) {
    query = query.limit(filters.limit)
  }

  const { data, error } = await query

  if (error) {
    console.error('[events/queries] getEvents error:', error.message)
    return []
  }

  return (data ?? []) as Event[]
}

export async function getEventById(id: string): Promise<Event | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('id', id)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null
    console.error('[events/queries] getEventById error:', error.message)
    return null
  }

  return data as Event
}

export async function getEventsBySignal(signalId: string): Promise<Event[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('signal_id', signalId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[events/queries] getEventsBySignal error:', error.message)
    return []
  }

  return (data ?? []) as Event[]
}
