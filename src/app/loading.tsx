export default function Loading(): React.JSX.Element {
  return (
    <div className="flex min-h-screen items-center justify-center bg-observatory-black">
      <div className="flex items-center gap-3">
        <span className="h-1 w-1 rounded-full bg-text-muted animate-signal-pulse" />
        <span className="h-1.5 w-1.5 rounded-full bg-text-secondary animate-signal-pulse [animation-delay:0.2s]" />
        <span className="h-1 w-1 rounded-full bg-text-muted animate-signal-pulse [animation-delay:0.4s]" />
      </div>
    </div>
  )
}
