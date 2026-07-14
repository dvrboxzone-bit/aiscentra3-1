'use client'

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}): React.JSX.Element {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-observatory-black">
      <div className="text-center">
        <p className="mb-2 text-xs tracking-[0.3em] text-text-muted uppercase">
          Observatory Error
        </p>
        <h2 className="mb-4 text-2xl font-light text-text-primary">
          Signal processing interrupted
        </h2>
        <p className="mb-8 text-sm text-text-muted">
          An unexpected error occurred in the Observatory.
        </p>
        <button
          onClick={reset}
          className="text-xs tracking-wider text-text-secondary hover:text-text-primary transition-colors"
        >
          Restart Observatory
        </button>
      </div>
    </main>
  )
}
