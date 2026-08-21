import type {
  Signal,
  SignalQualityReasonCode,
  SignalQualityState,
  SignalStatus,
} from '@/types/database'

export const SIGNAL_QUALITY_RULE_VERSION = 'quality-foundation-v1' as const

export const SIGNAL_QUALITY_STATES = [
  'PENDING',
  'APPROVED',
  'QUARANTINED',
] as const satisfies readonly SignalQualityState[]

const LEGACY_QUARANTINE_REASONS: Partial<Record<SignalStatus, SignalQualityReasonCode>> = {
  WEAK: 'LEGACY_STATUS_WEAK',
  DORMANT: 'LEGACY_STATUS_DORMANT',
  EXPIRED: 'LEGACY_STATUS_EXPIRED',
  REJECTED: 'LEGACY_STATUS_REJECTED',
}

export interface PlannedSignalQuality {
  state: Exclude<SignalQualityState, 'APPROVED'>
  reasonCodes: SignalQualityReasonCode[]
}

export interface SignalQualityAuditRow {
  status: SignalStatus
}

export interface SignalQualityAuditReport {
  total: number
  approved: number
  pending: number
  quarantined: number
  reasonCodes: Record<string, number>
  ruleVersion: typeof SIGNAL_QUALITY_RULE_VERSION
}

/**
 * Deterministic Phase-1 legacy classification. It deliberately has no
 * APPROVED branch: approval requires a separate, explicit quality review.
 */
export function planLegacySignalQuality(status: SignalStatus): PlannedSignalQuality {
  const quarantineReason = LEGACY_QUARANTINE_REASONS[status]
  if (quarantineReason) {
    return { state: 'QUARANTINED', reasonCodes: [quarantineReason] }
  }

  return { state: 'PENDING', reasonCodes: ['AWAITING_QUALITY_REVIEW'] }
}

export function isSignalQualityApproved(signal: Pick<Signal, 'quality_state'>): boolean {
  return signal.quality_state === 'APPROVED'
}

export function buildSignalQualityAudit(
  rows: readonly SignalQualityAuditRow[],
): SignalQualityAuditReport {
  const report: SignalQualityAuditReport = {
    total: rows.length,
    approved: 0,
    pending: 0,
    quarantined: 0,
    reasonCodes: {},
    ruleVersion: SIGNAL_QUALITY_RULE_VERSION,
  }

  for (const row of rows) {
    const planned = planLegacySignalQuality(row.status)
    report[planned.state === 'PENDING' ? 'pending' : 'quarantined'] += 1
    for (const reason of planned.reasonCodes) {
      report.reasonCodes[reason] = (report.reasonCodes[reason] ?? 0) + 1
    }
  }

  return report
}
