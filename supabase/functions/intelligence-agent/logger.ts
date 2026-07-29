/**
 * AIscentra — Intelligence Agent Runtime: Logger
 *
 * Every pipeline stage logs through this single implementation.
 * No dependency on Supabase — writes to console. A persistent log sink
 * (e.g. Supabase table) can be added later by swapping this implementation
 * without touching any calling code (all calls go through the AgentLogger interface).
 */
import type { AgentLogger, LogStage } from './interfaces'

export class ConsoleAgentLogger implements AgentLogger {
  log(stage: LogStage, message: string, data?: Record<string, unknown>): void {
    const timestamp = new Date().toISOString()
    const payload = data ? ` ${JSON.stringify(data)}` : ''
    console.log(`[agent:${stage}] ${timestamp} — ${message}${payload}`)
  }

  error(stage: LogStage, message: string, error?: unknown): void {
    const timestamp = new Date().toISOString()
    const errorDetail = error instanceof Error ? error.message : String(error ?? '')
    console.error(`[agent:${stage}] ${timestamp} — ERROR: ${message} ${errorDetail}`)
  }
}
