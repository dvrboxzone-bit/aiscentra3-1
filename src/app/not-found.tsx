import Link from 'next/link'

export default function NotFound(): React.JSX.Element {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-observatory-black">
      <div className="text-center">
        <p className="mb-2 text-xs tracking-[0.3em] text-text-muted uppercase">
          Observatory Signal
        </p>
        <h1 className="mb-2 text-6xl font-light text-text-primary">404</h1>
        <p className="mb-8 text-sm text-text-muted">
          This signal was not detected in the Observatory.
        </p>
        <Link
          href="/"
          className="text-xs tracking-wider text-text-secondary underline-offset-4 hover:text-text-primary hover:underline transition-colors"
        >
          Return to Observatory
        </Link>
      </div>
    </main>
  )
}
