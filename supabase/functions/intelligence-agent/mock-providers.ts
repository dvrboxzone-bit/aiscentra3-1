/**
 * AIscentra — Intelligence Agent Runtime: Mock Providers
 *
 * Implements every provider interface with static/generated in-memory data.
 * Used to exercise the full Runtime pipeline end-to-end before real signals
 * exist and before Supabase-backed providers are authorized for connection.
 *
 * Each Mock*Provider satisfies its interface exactly — swapping to a real
 * Supabase-backed implementation later requires no change to runtime.ts,
 * planner.ts, execution.ts, reflection.ts, or context-loader.ts.
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

// ── Mock Observation Provider ─────────────────────────────────────────────────

export class MockObservationProvider implements ObservationProvider {
  private readonly data: ObservationContextItem[] = [
    { id: 'obs-mock-1', title: 'Mock: New retrieval technique published', summary: 'A mock observation for testing.', sourceName: 'Mock ArXiv', collectedAt: new Date(Date.now() - 3600_000).toISOString() },
    { id: 'obs-mock-2', title: 'Mock: Lab announces new benchmark',       summary: 'Another mock observation.',       sourceName: 'Mock GitHub', collectedAt: new Date(Date.now() - 7200_000).toISOString() },
  ]

  async getRecent(limit: number): Promise<ObservationContextItem[]> {
    return this.data.slice(0, limit)
  }

  async getByEntity(_entityName: string, limit: number): Promise<ObservationContextItem[]> {
    return this.data.slice(0, limit)
  }

  async getById(id: string): Promise<ObservationContextItem | null> {
    return this.data.find(o => o.id === id) ?? null
  }
}

// ── Mock Signal Provider ──────────────────────────────────────────────────────

export class MockSignalProvider implements SignalProvider {
  private readonly data: SignalContextItem[] = [
    { id: 'sig-mock-1', title: 'Mock Signal: Agentic Runtime Layer', description: 'Mock description for testing the pipeline.', category: 'RESEARCH', signalScore: 65, intelligenceType: 'SIGNAL', createdAt: new Date(Date.now() - 3600_000).toISOString() },
    { id: 'sig-mock-2', title: 'Mock Signal: New Safety Benchmark',   description: 'Another mock signal for pipeline testing.',  category: 'RESEARCH', signalScore: 58, intelligenceType: 'WEAK_SIGNAL', createdAt: new Date(Date.now() - 7200_000).toISOString() },
  ]

  async getRecent(limit: number): Promise<SignalContextItem[]> {
    return this.data.slice(0, limit)
  }

  async getByCategory(category: string, limit: number): Promise<SignalContextItem[]> {
    return this.data.filter(s => s.category === category).slice(0, limit)
  }

  async getByEntity(_entityName: string, limit: number): Promise<SignalContextItem[]> {
    return this.data.slice(0, limit)
  }

  async getById(id: string): Promise<SignalContextItem | null> {
    return this.data.find(s => s.id === id) ?? null
  }
}

// ── Mock Graph Provider ───────────────────────────────────────────────────────

export class MockGraphProvider implements GraphProvider {
  private readonly nodes: GraphContextItem[] = [
    { id: 'node-mock-1', nodeType: 'signal', label: 'Mock Signal Node', description: 'Mock graph node.', importance: 5.0 },
  ]

  private readonly entities: EntityContextItem[] = [
    { id: 'entity-mock-1', canonicalName: 'Mock Entity', entityType: 'company', description: 'A mock canonical entity for testing.' },
  ]

  async getNode(nodeId: string): Promise<GraphContextItem | null> {
    return this.nodes.find(n => n.id === nodeId) ?? null
  }

  async getNodesByType(nodeType: string, limit: number): Promise<GraphContextItem[]> {
    return this.nodes.filter(n => n.nodeType === nodeType).slice(0, limit)
  }

  async getRelated(_nodeId: string, _relationType?: string): Promise<GraphContextItem[]> {
    return this.nodes
  }

  async getEntity(canonicalName: string): Promise<EntityContextItem | null> {
    return this.entities.find(e => e.canonicalName === canonicalName) ?? null
  }

  async searchEntities(query: string, limit: number): Promise<EntityContextItem[]> {
    const lower = query.toLowerCase()
    return this.entities
      .filter(e => e.canonicalName.toLowerCase().includes(lower))
      .slice(0, limit)
  }
}

// ── Mock Memory Provider ──────────────────────────────────────────────────────
// Strategic Memory is Phase 2 per Signal Engine V2 spec — this mock returns
// empty by default, matching real expected behavior until Phase 2 ships.

export class MockMemoryProvider implements MemoryProvider {
  private readonly entries: MemoryContextItem[] = []

  async getRelevant(_topic: string, limit: number): Promise<MemoryContextItem[]> {
    return this.entries.slice(0, limit)
  }

  async getByEntity(_entityName: string, limit: number): Promise<MemoryContextItem[]> {
    return this.entries.slice(0, limit)
  }

  async write(entry: Omit<MemoryContextItem, 'id'>): Promise<MemoryContextItem> {
    const created: MemoryContextItem = { ...entry, id: `mem-mock-${this.entries.length + 1}` }
    this.entries.push(created)
    return created
  }
}
