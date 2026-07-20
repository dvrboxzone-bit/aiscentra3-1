import { createClient } from '@/lib/supabase/server'
import type { Entity, EntityRelationship } from '@/types/database'

export async function getEntityById(id: string): Promise<Entity | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('entities')
    .select('*')
    .eq('id', id)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null
    console.error('[entities/queries] getEntityById error:', error.message)
    return null
  }

  return data as Entity
}

export async function getEntityByCanonicalName(canonicalName: string): Promise<Entity | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('entities')
    .select('*')
    .eq('canonical_name', canonicalName)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null
    console.error('[entities/queries] getEntityByCanonicalName error:', error.message)
    return null
  }

  return data as Entity
}

export async function getEntityRelationships(entityId: string): Promise<EntityRelationship[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('entity_relationships')
    .select('*')
    .or(`source_entity_id.eq.${entityId},target_entity_id.eq.${entityId}`)
    .order('strength', { ascending: false })

  if (error) {
    console.error('[entities/queries] getEntityRelationships error:', error.message)
    return []
  }

  return (data ?? []) as EntityRelationship[]
}
