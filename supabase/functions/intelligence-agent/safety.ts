/**
 * AIscentra — Intelligence Agent Runtime: Safety Layer
 *
 * Checks every action against an allow-list before Execution proceeds.
 * Deny-by-default for all write operations. Read actions are allowed by
 * default per AGENT_CONFIG.ALLOWED_ACTIONS_DEFAULT.
 *
 * If an action is denied, Execution MUST halt that step — this is enforced
 * by execution.ts checking SafetyProvider before dispatching to any tool.
 */
import type { SafetyProvider } from './interfaces'
import type { AgentAction, SafetyCheckResult } from './types'
import { AGENT_CONFIG } from './config'

const WRITE_ACTIONS: AgentAction[] = ['WRITE_MEMORY', 'WRITE_GRAPH', 'WRITE_SIGNAL']

export class DefaultSafetyProvider implements SafetyProvider {
  private readonly explicitlyAllowedWrites: Set<AgentAction>

  constructor(explicitlyAllowedWrites: AgentAction[] = []) {
    this.explicitlyAllowedWrites = new Set(explicitlyAllowedWrites)
  }

  checkAction(action: AgentAction): SafetyCheckResult {
    // Read actions — allowed by default
    if ((AGENT_CONFIG.ALLOWED_ACTIONS_DEFAULT as readonly string[]).includes(action)) {
      return { allowed: true, reason: null }
    }

    // Write actions — deny unless explicitly allowed
    if (WRITE_ACTIONS.includes(action)) {
      if (AGENT_CONFIG.WRITE_ACTIONS_REQUIRE_EXPLICIT_ALLOW && !this.explicitlyAllowedWrites.has(action)) {
        return {
          allowed: false,
          reason:  `Write action '${action}' requires explicit allow-list entry. Denied by default safety posture.`,
        }
      }
      return { allowed: true, reason: null }
    }

    // CALL_TOOL and GENERATE_REPORT — allowed (non-destructive, no data mutation)
    if (action === 'CALL_TOOL' || action === 'GENERATE_REPORT') {
      return { allowed: true, reason: null }
    }

    // Unknown action — deny
    return { allowed: false, reason: `Unknown action '${action}' — not in any allow-list.` }
  }
}
