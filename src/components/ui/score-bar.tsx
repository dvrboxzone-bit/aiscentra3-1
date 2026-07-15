import { cn } from '@/lib/utils/cn'

interface ScoreBarProps {
  value: number       // 0–100
  label?: string
  className?: string
  showValue?: boolean
}

export function ScoreBar({ value, label, className, showValue = true }: ScoreBarProps): React.JSX.Element {
  const clamped = Math.max(0, Math.min(100, value))

  // Color shifts from muted → bright as score increases
  const barColor =
    clamped >= 80 ? 'bg-text-primary' :
    clamped >= 60 ? 'bg-text-secondary' :
    clamped >= 40 ? 'bg-text-muted' :
    'bg-observatory-border'

  return (
    <div className={cn('flex items-center gap-2', className)}>
      {label && (
        <span className="w-16 shrink-0 text-right font-mono text-xs text-text-muted">
          {label}
        </span>
      )}
      <div className="h-px flex-1 bg-observatory-border">
        <div
          className={cn('h-px transition-all', barColor)}
          style={{ width: `${clamped}%` }}
        />
      </div>
      {showValue && (
        <span className="w-7 shrink-0 font-mono text-xs tabular-nums text-text-muted">
          {clamped}
        </span>
      )}
    </div>
  )
}
