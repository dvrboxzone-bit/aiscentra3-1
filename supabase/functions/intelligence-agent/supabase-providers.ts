/**
 * AIscentra — Intelligence Agent Runtime: Supabase Provider Implementations
 *
 * Production data providers reading from the real Observatory database.
 * Each class satisfies an EXISTING interface from interfaces.ts exactly —
 * zero interface changes were required to add these.
 *
 * Uses @supabase/supabase-js directly (not the Next.js-specific
 * src/lib/supabase/server.ts, which depends on `next/headers` and is not
 * usable from this Deno-context directory). This mirrors the same pattern
 * groq-reasoning-engine.ts already uses for src/lib/ai — a plain dynamic
 * import of a portable, framework-agnostic dependency.
 *
 * Environment variables required (read lazily, at call time, not at
 * module-load time — matching the existing lazy-env pattern used
 * throughout src/lib/ai/*):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Entity resolution: GraphProvider.getEntity()/searchEntities() read from
 * `entity_registry` (canonical entities, Signal Engine V2's Entity
 * Resolution layer) rather than the raw `entities` table — entity_registry
 * is the authoritative canonical-name source per Signal Engine V2 spec.
 * There is no separate EntityProvider interface; entity access is part of
 * the existing GraphProvider contract.
 *
 * Strategic Memory: no `strategic_memory` table exists yet (Phase 2 per
 * Signal Engine V2 Acceptance document). SupabaseMemoryProvider.getRelevant()
 * and getByEntity() return an empty array — identical behavior to
 * MockMemoryProvider — rather than querying a table that does not exist.
 * write() throws explicitly rather than silently no-op'ing, since silently
 * discarding a write would hide data loss.
 */
import type {
  ObservationProvider,
  SignalProvider,
  GraphProvider,
  MemoryProvider,
} from './interfaces'
import type {
  ObservationContextItem,
  SignalContextItem,
  GraphContextItem,
  MemoryContextItem,
  EntityContextItem,
} from './types'

// ── Lazy Supabase client ──────────────────────────────────────────────────────
// Not instantiated at module load — only when a provider method is actually
// called. Avoids failing module import in contexts where env vars are not
// yet set (e.g. mock-only test runs that never touch this file).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cachedClient: any = null

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getSupabaseClient(): Promise<any> {
  if (cachedClient) return cachedClient

  const url = process.env['NEXT_PUBLIC_SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']

  if (!url || !key) {
    throw new Error(
      '[supabase-providers] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. ' +
      'Set both in Vercel Environment Variables to use Supabase-backed providers.',
    )
  }

  const { createClient } = await import('@supabase/supabase-js')
  cachedClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return cachedClient
}

// ── Supabase Observation Provider ─────────────────────────────────────────────

export class SupabaseObservationProvider implements ObservationProvider {
  async getRecent(limit: number): Promise<ObservationContextItem[]> {
    const supabase = await getSupabaseClient()
    const { data, error } = await supabase
      .from('observations')
      .select('id, title, content, collected_at, source_id, sources(name)')
      .order('collected_at', { ascending: false })
      .limit(limit)

    if (error) throw new Error(`[SupabaseObservationProvider.getRecent] ${error.message}`)
    return (data ?? []).map(mapObservationRow)
  }

  async getByEntity(entityName: string, limit: number): Promise<ObservationContextItem[]> {
    const supabase = await getSupabaseClient()
    // Observations do not carry entity_ids directly (entities are resolved at
    // Signal creation time, not Observation time, per Signal Engine V2
    // pipeline). Fall back to a title/content text match as the closest
    // available signal at the Observation layer.
    const { data, error } = await supabase
      .from('observations')
      .select('id, title, content, collected_at, source_id, sources(name)')
      .or(`title.ilike.%${entityName}%,content.ilike.%${entityName}%`)
      .order('collected_at', { ascending: false })
      .limit(limit)

    if (error) throw new Error(`[SupabaseObservationProvider.getByEntity] ${error.message}`)
    return (data ?? []).map(mapObservationRow)
  }

  async getById(id: string): Promise<ObservationContextItem | null> {
    const supabase = await getSupabaseClient()
    const { data, error } = await supabase
      .from('observations')
      .select('id, title, content, collected_at, source_id, sources(name)')
      .eq('id', id)
      .maybeSingle()

    if (error) throw new Error(`[SupabaseObservationProvider.getById] ${error.message}`)
    return data ? mapObservationRow(data) : null
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapObservationRow(row: any): ObservationContextItem {
  return {
    id:          row.id,
    title:       row.title,
    summary:     typeof row.content === 'string' ? row.content.slice(0, 300) : '',
    sourceName:  row.sources?.name ?? 'Unknown',
    collectedAt: row.collected_at,
  }
}

// ── Supabase Signal Provider ──────────────────────────────────────────────────

export class SupabaseSignalProvider implements SignalProvider {
  async getRecent(limit: number): Promise<SignalContextItem[]> {
    const supabase = await getSupabaseClient()
    const { data, error } = await supabase
      .from('signals')
      .select('id, title, description, category, signal_score, intelligence_type, created_at')
      .eq('status', 'ACTIVE')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) throw new Error(`[SupabaseSignalProvider.getRecent] ${error.message}`)
    return (data ?? []).map(mapSignalRow)
  }

  async getByCategory(category: string, limit: number): Promise<SignalContextItem[]> {
    const supabase = await getSupabaseClient()
    const { data, error } = await supabase
      .from('signals')
      .select('id, title, description, category, signal_score, intelligence_type, created_at')
      .eq('status', 'ACTIVE')
      .eq('category', category)
      .order('signal_score', { ascending: false })
      .limit(limit)

    if (error) throw new Error(`[SupabaseSignalProvider.getByCategory] ${error.message}`)
    return (data ?? []).map(mapSignalRow)
  }

  async getByEntity(entityName: string, limit: number): Promise<SignalContextItem[]> {
    const supabase = await getSupabaseClient()
    // Resolve entityName to a canonical entity id first, then filter signals
    // whose entity_ids array contains it — mirrors Signal Engine V2's
    // entity_ids column on the signals table.
    const { data: entityRow } = await supabase
      .from('entities')
      .select('id')
      .eq('canonical_name', entityName.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim())
      .maybeSingle()

    if (!entityRow) {
      // No matching entity — fall back to a title/description text match
      const { data, error } = await supabase
        .from('signals')
        .select('id, title, description, category, signal_score, intelligence_type, created_at')
        .eq('status', 'ACTIVE')
        .or(`title.ilike.%${entityName}%,description.ilike.%${entityName}%`)
        .order('signal_score', { ascending: false })
        .limit(limit)

      if (error) throw new Error(`[SupabaseSignalProvider.getByEntity] ${error.message}`)
      return (data ?? []).map(mapSignalRow)
    }

    const { data, error } = await supabase
      .from('signals')
      .select('id, title, description, category, signal_score, intelligence_type, created_at')
      .eq('status', 'ACTIVE')
      .contains('entity_ids', [entityRow.id])
      .order('signal_score', { ascending: false })
      .limit(limit)

    if (error) throw new Error(`[SupabaseSignalProvider.getByEntity] ${error.message}`)
    return (data ?? []).map(mapSignalRow)
  }

  async getById(id: string): Promise<SignalContextItem | null> {
    const supabase = await getSupabaseClient()
    const { data, error } = await supabase
      .from('signals')
      .select('id, title, description, category, signal_score, intelligence_type, created_at')
      .eq('id', id)
      .maybeSingle()

    if (error) throw new Error(`[SupabaseSignalProvider.getById] ${error.message}`)
    return data ? mapSignalRow(data) : null
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapSignalRow(row: any): SignalContextItem {
  return {
    id:               row.id,
    title:            row.title,
    description:      row.description,
    category:         row.category,
    signalScore:      row.signal_score,
    intelligenceType: row.intelligence_type ?? 'SIGNAL',
    createdAt:        row.created_at,
  }
}

// ── Supabase Graph Provider ───────────────────────────────────────────────────
// Reads from knowledge_graph_nodes (graph structure), intelligence_graph
// (edges), and entity_registry (canonical entities — Signal Engine V2's
// Entity Resolution layer, authoritative over the raw `entities` table).

export class SupabaseGraphProvider implements GraphProvider {
  async getNode(nodeId: string): Promise<GraphContextItem | null> {
    const supabase = await getSupabaseClient()
    const { data, error } = await supabase
      .from('knowledge_graph_nodes')
      .select('id, node_type, label, description, importance_score')
      .eq('id', nodeId)
      .maybeSingle()

    if (error) throw new Error(`[SupabaseGraphProvider.getNode] ${error.message}`)
    return data ? mapGraphNodeRow(data) : null
  }

  async getNodesByType(nodeType: string, limit: number): Promise<GraphContextItem[]> {
    const supabase = await getSupabaseClient()
    const { data, error } = await supabase
      .from('knowledge_graph_nodes')
      .select('id, node_type, label, description, importance_score')
      .eq('node_type', nodeType)
      .eq('is_canonical', true)
      .order('importance_score', { ascending: false, nullsFirst: false })
      .limit(limit)

    if (error) throw new Error(`[SupabaseGraphProvider.getNodesByType] ${error.message}`)
    return (data ?? []).map(mapGraphNodeRow)
  }

  async getRelated(nodeId: string, relationType?: string): Promise<GraphContextItem[]> {
    const supabase = await getSupabaseClient()

    let query = supabase
      .from('intelligence_graph')
      .select('to_node_id, relation_type, confidence')
      .eq('from_node_id', nodeId)
      .gte('confidence', 0.7) // matches existing RLS "Public can read high-confidence edges" policy

    if (relationType) query = query.eq('relation_type', relationType)

    const { data: edges, error: edgeError } = await query
    if (edgeError) throw new Error(`[SupabaseGraphProvider.getRelated] ${edgeError.message}`)
    if (!edges || edges.length === 0) return []

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nodeIds = edges.map((e: any) => e.to_node_id)
    const { data: nodes, error: nodeError } = await supabase
      .from('knowledge_graph_nodes')
      .select('id, node_type, label, description, importance_score')
      .in('id', nodeIds)

    if (nodeError) throw new Error(`[SupabaseGraphProvider.getRelated] ${nodeError.message}`)
    return (nodes ?? []).map(mapGraphNodeRow)
  }

  async getEntity(canonicalName: string): Promise<EntityContextItem | null> {
    const supabase = await getSupabaseClient()
    const { data, error } = await supabase
      .from('entity_registry')
      .select('id, canonical_name, entity_type, description')
      .eq('canonical_name', canonicalName)
      .eq('verified', true)
      .maybeSingle()

    if (error) throw new Error(`[SupabaseGraphProvider.getEntity] ${error.message}`)
    return data ? mapEntityRow(data) : null
  }

  async searchEntities(query: string, limit: number): Promise<EntityContextItem[]> {
    const supabase = await getSupabaseClient()
    // entity_registry.aliases is a GIN-indexed text[] — search both canonical
    // name and aliases, matching how Entity Resolution actually stores
    // alternative names (e.g. "Open AI", "OpenAI Inc" as aliases of "OpenAI").
    const { data, error } = await supabase
      .from('entity_registry')
      .select('id, canonical_name, entity_type, description')
      .eq('verified', true)
      .or(`canonical_name.ilike.%${query}%,aliases.cs.{${query}}`)
      .limit(limit)

    if (error) throw new Error(`[SupabaseGraphProvider.searchEntities] ${error.message}`)
    return (data ?? []).map(mapEntityRow)
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapGraphNodeRow(row: any): GraphContextItem {
  return {
    id:          row.id,
    nodeType:    row.node_type,
    label:       row.label,
    description: row.description ?? null,
    importance:  row.importance_score ?? null,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapEntityRow(row: any): EntityContextItem {
  return {
    id:            row.id,
    canonicalName: row.canonical_name,
    entityType:    row.entity_type,
    description:   row.description ?? null,
  }
}

// ── Supabase Memory Provider ──────────────────────────────────────────────────
// No `strategic_memory` table exists yet (Phase 2, per
// SIGNAL_ENGINE_V2_ACCEPTANCE.md Section 2 gating). Returns empty arrays —
// identical behavior to MockMemoryProvider — rather than querying a
// nonexistent table. write() throws explicitly: silently discarding a write
// would hide data loss, which contradicts the Context Loader's "state the
// gap, don't hide it" philosophy that this whole Runtime is built around.

export class SupabaseMemoryProvider implements MemoryProvider {
  async getRelevant(_topic: string, _limit: number): Promise<MemoryContextItem[]> {
    return []
  }

  async getByEntity(_entityName: string, _limit: number): Promise<MemoryContextItem[]> {
    return []
  }

  async write(_entry: Omit<MemoryContextItem, 'id'>): Promise<MemoryContextItem> {
    throw new Error(
      '[SupabaseMemoryProvider.write] strategic_memory table does not exist yet ' +
      '(Phase 2, per SIGNAL_ENGINE_V2_ACCEPTANCE.md). Cannot persist this write.',
    )
  }
}
