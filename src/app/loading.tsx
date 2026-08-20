import { VfinalPublicShell } from '@/components/layout/vfinal-public-shell'

/**
 * AIscentra — vfinal global loading state (Frontend Design Foundation,
 * layer 5C). Same shared header/footer as every real page (via
 * VfinalPublicShell) -- not a bare, unbranded loading screen.
 */
export default function Loading(): React.JSX.Element {
  return (
    <VfinalPublicShell>
      <div
        className="flex min-h-[60vh] items-center justify-center px-6"
        role="status"
        aria-live="polite"
      >
        <div className="flex items-center gap-3">
          <span className="h-1 w-1 animate-pulse rounded-full bg-mint-signal" />
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-frost [animation-delay:0.2s]" />
          <span className="h-1 w-1 animate-pulse rounded-full bg-mint-signal [animation-delay:0.4s]" />
        </div>
        <span className="sr-only">Loading</span>
      </div>
    </VfinalPublicShell>
  )
}
