import { cn } from '@/lib/utils/cn'
import { formatCategory } from '@/lib/utils/format'
import type { SignalCategory, SignalSeverity } from '@/types/database'

// ── Severity Badge ────────────────────────────────────────────────────────────

interface SeverityBadgeProps {
  severity: SignalSeverity
  score: number
  className?: string
}

const SEVERITY_STYLES: Record<SignalSeverity, string> = {
  CRITICAL: 'text-text-primary border-text-primary/30 bg-text-primary/5',
  HIGH:     'text-signal-high border-signal-high/30 bg-signal-high/5',
  MEDIUM:   'text-signal-medium border-signal-medium/25 bg-signal-medium/5',
  LOW:      'text-signal-low border-signal-low/20 bg-signal-low/5',
}

export function SeverityBadge({ severity, score, className }: SeverityBadgeProps): React.JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 border px-2 py-0.5 font-mono text-xs tracking-wider',
        SEVERITY_STYLES[severity],
        className,
      )}
    >
      <span className="tabular-nums">{score}</span>
      <span className="opacity-60">/</span>
      <span>{severity}</span>
    </span>
  )
}

// ── Category Badge ────────────────────────────────────────────────────────────

interface CategoryBadgeProps {
  category: SignalCategory
  className?: string
}

export function CategoryBadge({ category, className }: CategoryBadgeProps): React.JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center border border-observatory-border px-2 py-0.5 text-xs tracking-wider text-text-muted',
        className,
      )}
    >
      {formatCategory(category)}
    </span>
  )
}

// ── Confidence Badge ──────────────────────────────────────────────────────────

interface ConfidenceBadgeProps {
  score: number
  className?: string
}

export function ConfidenceBadge({ score, className }: ConfidenceBadgeProps): React.JSX.Element {
  const level = score >= 80 ? 'high' : score >= 60 ? 'medium' : 'low'
  const styles = {
    high:   'text-text-secondary border-text-secondary/20',
    medium: 'text-text-muted border-observatory-border',
    low:    'text-text-muted/60 border-observatory-border/50',
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 border px-2 py-0.5 font-mono text-xs',
        styles[level],
        className,
      )}
    >
      <span className="text-text-muted">CONF</span>
      <span className="tabular-nums">{score}%</span>
    </span>
  )
}
