import Link from 'next/link'
import { SeverityBadge, CategoryBadge, ConfidenceBadge } from '@/components/ui/badge'
import { ScoreBar } from '@/components/ui/score-bar'
import { formatRelativeTime } from '@/lib/utils/format'
import { getSignalSeverity } from '@/types/database'
import { cn } from '@/lib/utils/cn'
import type { Signal } from '@/types/database'

interface SignalCardProps {
  signal: Signal
  variant?: 'default' | 'compact' | 'featured'
  className?: string
}

/**
 * Signal Card — primary display unit for the Observatory.
 * Design Foundation v1.0: "Signals should visually resemble intelligence reports rather than news cards."
 */
export function SignalCard({
  signal,
  variant = 'default',
  className,
}: SignalCardProps): React.JSX.Element {
  const severity = getSignalSeverity(signal.signal_score)
  const href = `/signals/${signal.id}`

  if (variant === 'compact') {
    return (
      <Link
        href={href}
        className={cn(
          'group flex items-start gap-4 border-b border-observatory-border px-4 py-3',
          'transition-colors hover:bg-observatory-surface',
          className,
        )}
      >
        {/* Score column */}
        <div className="w-8 shrink-0 pt-0.5 text-right font-mono text-xs tabular-nums text-text-muted">
          {signal.signal_score}
        </div>
        {/* Content */}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-text-secondary transition-colors group-hover:text-text-primary">
            {signal.title}
          </p>
        </div>
        {/* Meta */}
        <div className="shrink-0 text-right">
          <CategoryBadge category={signal.category} />
        </div>
      </Link>
    )
  }

  if (variant === 'featured') {
    return (
      <Link
        href={href}
        className={cn(
          'group block border border-observatory-border bg-observatory-surface p-6',
          'transition-all hover:border-observatory-border/80 hover:bg-observatory-dark',
          className,
        )}
      >
        {/* Header row */}
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={severity} score={signal.signal_score} />
            <CategoryBadge category={signal.category} />
          </div>
          <time className="shrink-0 font-mono text-xs text-text-muted" dateTime={signal.created_at}>
            {formatRelativeTime(signal.created_at)}
          </time>
        </div>

        {/* Title */}
        <h3 className="mb-3 text-base font-medium leading-snug text-text-primary transition-colors group-hover:text-white">
          {signal.title}
        </h3>

        {/* Description */}
        <p className="mb-4 text-sm leading-relaxed text-text-muted line-clamp-2">
          {signal.description}
        </p>

        {/* Score bars */}
        <div className="space-y-1.5 border-t border-observatory-border pt-4">
          <ScoreBar value={signal.signal_score}     label="Signal" />
          <ScoreBar value={signal.confidence_score} label="Conf" />
          <ScoreBar value={signal.momentum_score}   label="Momentum" />
        </div>
      </Link>
    )
  }

  // Default variant
  return (
    <Link
      href={href}
      className={cn(
        'group block border-b border-observatory-border px-6 py-5',
        'transition-colors hover:bg-observatory-surface',
        className,
      )}
    >
      {/* Header row */}
      <div className="mb-2 flex items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <SeverityBadge severity={severity} score={signal.signal_score} />
          <CategoryBadge category={signal.category} />
          <ConfidenceBadge score={signal.confidence_score} />
        </div>
        <time className="shrink-0 font-mono text-xs text-text-muted" dateTime={signal.created_at}>
          {formatRelativeTime(signal.created_at)}
        </time>
      </div>

      {/* Title */}
      <h3 className="mb-1.5 text-sm font-medium leading-snug text-text-secondary transition-colors group-hover:text-text-primary">
        {signal.title}
      </h3>

      {/* Description */}
      <p className="text-xs leading-relaxed text-text-muted line-clamp-2">
        {signal.description}
      </p>
    </Link>
  )
}
