import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'About',
  description: 'AIscentra is an independent Intelligence Observatory dedicated to monitoring the global AI ecosystem.',
}

export default function AboutPage(): React.JSX.Element {
  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <header className="mb-10">
        <p className="mb-2 font-mono text-xs tracking-[0.3em] text-text-muted">
          INTELLIGENCE OBSERVATORY
        </p>
        <h1 className="text-3xl font-light text-text-primary">About AIscentra</h1>
      </header>

      <div className="space-y-8 text-sm leading-relaxed text-text-muted">
        <p>
          AIscentra is an independent Intelligence Observatory dedicated to the continuous
          observation, analysis, interpretation and systematisation of the global Artificial
          Intelligence ecosystem.
        </p>

        <p>
          AIscentra is not a news website. Not a blog. Not a directory.
          It is a digital observatory designed to transform fragmented information
          into structured intelligence.
        </p>

        <div className="border-l border-observatory-border pl-4 py-1">
          <p className="mb-2 font-mono text-xs tracking-wider text-text-muted">MISSION</p>
          <p className="text-text-secondary">Observe. Analyze. Accelerate the Future.</p>
        </div>

        <div>
          <p className="mb-3 font-mono text-xs tracking-wider text-text-muted">HOW IT WORKS</p>
          <div className="space-y-3">
            {[
              ['Observation', 'The Observatory continuously monitors approved sources across the AI ecosystem — company blogs, research repositories, regulatory bodies and technical platforms.'],
              ['Signal Detection', 'Observations are scored across five dimensions: ecosystem impact, actor significance, novelty, verifiability and strategic relevance. Only meaningful developments become signals.'],
              ['Event Generation', 'Signals that cross significance and confidence thresholds are promoted to events — enriched with impact analysis and forward context.'],
              ['Intelligence', 'Events are synthesised into intelligence reports and accessible through the Observatory Assistant.'],
            ].map(([title, desc]) => (
              <div key={title} className="border border-observatory-border p-4">
                <p className="mb-1.5 font-mono text-xs text-text-secondary">{title}</p>
                <p>{desc}</p>
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-3 font-mono text-xs tracking-wider text-text-muted">CORE PRINCIPLE</p>
          <p>
            Information alone has little value. Interpretation creates value. Signals create intelligence.
          </p>
        </div>
      </div>
    </div>
  )
}
