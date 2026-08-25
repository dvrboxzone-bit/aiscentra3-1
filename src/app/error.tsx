'use client'

import { useEffect } from 'react'
import * as Sentry from '@sentry/nextjs'

import { VfinalPublicShell } from '@/components/layout/vfinal-public-shell'

function SentryErrorCapture({ error }: { error: Error }): null {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])
  return null
}

/**
 * AIscentra — vfinal global error boundary (Frontend Design
 * Foundation, layer 5C). Real `reset` callback (the actual Next.js
 * error-boundary reset function, unchanged) still wired to the button
 * -- not a rewritten/simulated reset. Same shared header/footer as
 * every real page.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}): React.JSX.Element {
  return (
    <VfinalPublicShell>
      <SentryErrorCapture error={error} />
      <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
        <span className="font-caption mb-2 text-silver-haze">OBSERVATORY ERROR</span>
        <h1 className="font-heading mb-4 text-3xl text-frost">Signal processing interrupted</h1>
        <p className="mb-8 text-silver-haze">An unexpected error occurred in the Observatory.</p>
        <button onClick={reset} className="btn-pill magnetic text-sm">
          Restart Observatory
        </button>
      </div>
    </VfinalPublicShell>
  )
}
