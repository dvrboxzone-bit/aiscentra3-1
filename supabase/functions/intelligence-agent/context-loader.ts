/**
 * AIscentra — Intelligence Agent Runtime: Context Loader
 *
 * Assembles AgentContext from an ExecutionPlan. Reads ONLY through the
 * provider interfaces (ObservationProvider, SignalProvider, GraphProvider,
 * MemoryProvider) — never touches Supabase or any concrete data source
 * directly. Concrete providers are injected via the constructor.
 *
 * Explicitly tracks gaps — what could not be found — rather than silently
 * returning an incomplete context. This mirrors the Signal Engine's own
 * "state the gap, don't hide it" philosophy.
 */
import type {
  ObservationProvider,
  SignalProvider,
  GraphProvider,
  MemoryProvider,
  AgentLogger,
} from './interfaces'
import type { AgentContext, AgentTask, ExecutionPlan } from './types'
import { AGENT_CONFIG } from './config'

export interface ContextLoaderDeps {
  observationProvider: ObservationProvider
  signalProvider:      SignalProvider
  graphProvider:       GraphProvider
  memoryProvider:      MemoryProvider
  logger:              AgentLogger
}

export class ContextLoader {
  constructor(private readonly deps: ContextLoaderDeps) {}

  async load(task: AgentTask, plan: ExecutionPlan): Promise<AgentContext> {
    const { observationProvider, signalProvider, graphProvider, memoryProvider, logger } = this.deps
    const gaps: string[] = []

    const context: AgentContext = {
      taskId:        task.id,
      observations:  [],
      signals:       [],
      graphNodes:    [],
      memoryEntries: [],
      entities:      [],
      loadedAt:      new Date().toISOString(),
      gaps:          [],
    }

    const stepKinds = new Set(plan.steps.map(s => s.kind))

    if (stepKinds.has('LOAD_OBSERVATIONS')) {
      try {
        context.observations = await observationProvider.getRecent(AGENT_CONFIG.MAX_OBSERVATIONS_PER_LOAD)
        logger.log('CONTEXT_LOADER', `Loaded ${context.observations.length} observations`)
      } catch (err) {
        logger.error('CONTEXT_LOADER', 'Failed to load observations', err)
        gaps.push('Observations could not be loaded — observation provider error')
      }
    }

    if (stepKinds.has('LOAD_SIGNALS')) {
      try {
        context.signals = await signalProvider.getRecent(AGENT_CONFIG.MAX_SIGNALS_PER_LOAD)
        logger.log('CONTEXT_LOADER', `Loaded ${context.signals.length} signals`)
      } catch (err) {
        logger.error('CONTEXT_LOADER', 'Failed to load signals', err)
        gaps.push('Signals could not be loaded — signal provider error')
      }
    }

    if (stepKinds.has('LOAD_GRAPH')) {
      try {
        context.graphNodes = await graphProvider.getNodesByType('signal', AGENT_CONFIG.MAX_GRAPH_NODES_PER_LOAD)
        logger.log('CONTEXT_LOADER', `Loaded ${context.graphNodes.length} graph nodes`)
      } catch (err) {
        logger.error('CONTEXT_LOADER', 'Failed to load graph nodes', err)
        gaps.push('Knowledge graph could not be loaded — graph provider error')
      }
    }

    if (stepKinds.has('LOAD_MEMORY')) {
      try {
        context.memoryEntries = await memoryProvider.getRelevant(task.query, AGENT_CONFIG.MAX_MEMORY_ENTRIES)
        logger.log('CONTEXT_LOADER', `Loaded ${context.memoryEntries.length} memory entries`)
        if (context.memoryEntries.length === 0) {
          gaps.push('No prior strategic memory found for this topic — Strategic Memory is Phase 2, not yet populated')
        }
      } catch (err) {
        logger.error('CONTEXT_LOADER', 'Failed to load memory', err)
        gaps.push('Strategic memory could not be loaded — memory provider error')
      }
    }

    if (stepKinds.has('LOAD_ENTITY')) {
      try {
        const entityQuery = (task.parameters['entityName'] as string | undefined) ?? task.query
        context.entities = await graphProvider.searchEntities(entityQuery, AGENT_CONFIG.MAX_ENTITIES_PER_LOAD)
        logger.log('CONTEXT_LOADER', `Loaded ${context.entities.length} entities`)
        if (context.entities.length === 0) {
          gaps.push(`No canonical entity found matching "${entityQuery}"`)
        }
      } catch (err) {
        logger.error('CONTEXT_LOADER', 'Failed to load entities', err)
        gaps.push('Entity registry could not be queried — graph provider error')
      }
    }

    context.gaps = gaps
    return context
  }
}
