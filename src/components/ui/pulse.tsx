import { cn } from '@/lib/utils/cn'

interface PulseProps {
  active?: boolean
  size?: 'sm' | 'md'
  className?: string
}

/**
 * Observatory activity pulse indicator.
 * Design Foundation v1.0: "signal pulses" communicate activity, not decoration.
 */
export function Pulse({ active = true, size = 'sm', className }: PulseProps): React.JSX.Element {
  const sizes = { sm: 'h-1.5 w-1.5', md: 'h-2 w-2' }

  return (
    <span className={cn('relative inline-flex', sizes[size], className)}>
      {active && (
        <span
          className={cn(
            'absolute inline-flex h-full w-full animate-ping rounded-full bg-text-muted opacity-50',
          )}
        />
      )}
      <span
        className={cn(
          'relative inline-flex rounded-full',
          sizes[size],
          active ? 'bg-text-secondary' : 'bg-observatory-border',
        )}
      />
    </span>
  )
}
