/**
 * AIscentra — Formatting Utilities
 *
 * Centralised formatting so display decisions are made in one place.
 * Changing how a score is displayed means changing one function, not hunting components.
 */
import { getSignalSeverity } from '@/types/database'
import type { SignalCategory, SignalSeverity } from '@/types/database'

// ── Score Formatting ─────────────────────────────────────────────────────────

export function formatSignalScore(score: number): string {
  return score.toString().padStart(2, '0')
}

export function formatConfidenceScore(score: number): string {
  return `${score}%`
}

export function severityFromScore(score: number): SignalSeverity {
  return getSignalSeverity(score)
}

// ── Category Labels ──────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<SignalCategory, string> = {
  RESEARCH:       'Research',
  MODELS:         'Models',
  COMPANIES:      'Companies',
  INFRASTRUCTURE: 'Infrastructure',
  OPEN_SOURCE:    'Open Source',
  FUNDING:        'Funding',
  REGULATION:     'Regulation',
  AGENTS:         'Agents',
  HARDWARE:       'Hardware',
}

export function formatCategory(category: SignalCategory): string {
  return CATEGORY_LABELS[category]
}

// ── Date Formatting ──────────────────────────────────────────────────────────

const DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  year: 'numeric', month: 'short', day: 'numeric',
})

const RELATIVE_FORMATTER = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

export function formatDate(dateString: string): string {
  return DATE_FORMATTER.format(new Date(dateString))
}

export function formatRelativeTime(dateString: string): string {
  const seconds = (new Date(dateString).getTime() - Date.now()) / 1000
  const absSeconds = Math.abs(seconds)

  if (absSeconds < 60)   return RELATIVE_FORMATTER.format(Math.round(seconds), 'second')
  if (absSeconds < 3600) return RELATIVE_FORMATTER.format(Math.round(seconds / 60), 'minute')
  if (absSeconds < 86400) return RELATIVE_FORMATTER.format(Math.round(seconds / 3600), 'hour')
  if (absSeconds < 2592000) return RELATIVE_FORMATTER.format(Math.round(seconds / 86400), 'day')
  return formatDate(dateString)
}

// ── Severity Display ─────────────────────────────────────────────────────────

/**
 * Returns Tailwind classes for severity level display.
 * Design Foundation v1.0: signal colors exist only for intelligence classification.
 */
export function getSeverityClasses(severity: SignalSeverity): {
  text: string
  bg: string
  border: string
} {
  const map: Record<SignalSeverity, { text: string; bg: string; border: string }> = {
    CRITICAL: {
      text:   'text-text-primary',
      bg:     'bg-observatory-surface',
      border: 'border-text-primary/40',
    },
    HIGH: {
      text:   'text-signal-high',
      bg:     'bg-observatory-surface',
      border: 'border-signal-high/30',
    },
    MEDIUM: {
      text:   'text-signal-medium',
      bg:     'bg-observatory-surface',
      border: 'border-signal-medium/20',
    },
    LOW: {
      text:   'text-signal-low',
      bg:     'bg-observatory-surface',
      border: 'border-signal-low/15',
    },
  }
  return map[severity]
}
