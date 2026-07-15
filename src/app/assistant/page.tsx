import type { Metadata } from 'next'
import { Pulse } from '@/components/ui/pulse'

export const metadata: Metadata = {
  title: 'Observatory Assistant',
  description: 'Query Observatory intelligence using natural language. Powered by accumulated signal and event knowledge.',
}

// Example questions that demonstrate the Assistant's scope
const EXAMPLE_QUERIES = [
  'What are the most significant AI model releases this month?',
  'How has funding activity in the AI sector changed recently?',
  'What regulatory developments should I be tracking?',
  'Which companies have shown the most signal activity?',
  'What open source releases are gaining momentum?',
]

export default function AssistantPage(): React.JSX.Element {
  return (
    <div className="mx-auto max-w-3xl px-6 py-12">

      {/* Header */}
      <div className="mb-10 text-center">
        <div className="mb-4 flex items-center justify-center gap-2">
          <Pulse size="md" />
          <span className="font-mono text-xs tracking-[0.3em] text-text-muted">
            OBSERVATORY ASSISTANT
          </span>
        </div>
        <h1 className="mb-3 text-2xl font-light text-text-primary">
          Ask the Observatory
        </h1>
        <p className="text-sm text-text-muted">
          Query signals, events and intelligence using natural language.
          The Assistant uses only verified Observatory data — not general AI knowledge.
        </p>
      </div>

      {/* Input area — Stage 13 activation */}
      <div className="mb-8 border border-observatory-border bg-observatory-surface">
        <div className="flex items-center gap-3 px-4 py-3">
          <Pulse size="sm" active={false} />
          <p className="flex-1 text-sm text-text-muted">
            Assistant activates in Stage 13 — Knowledge Retrieval Layer
          </p>
        </div>
        <div className="border-t border-observatory-border p-4">
          <p className="font-mono text-xs text-text-muted">
            The Assistant requires a populated knowledge base to operate. It will become
            available once the Observatory has processed sufficient signals and events
            to provide grounded, evidence-linked responses.
          </p>
        </div>
      </div>

      {/* Example queries */}
      <div>
        <p className="mb-4 font-mono text-xs tracking-wider text-text-muted">
          EXAMPLE QUERIES — AVAILABLE WHEN ASSISTANT IS ACTIVE
        </p>
        <div className="space-y-2">
          {EXAMPLE_QUERIES.map((query) => (
            <div
              key={query}
              className="border border-observatory-border px-4 py-3 text-sm text-text-muted opacity-60"
            >
              {query}
            </div>
          ))}
        </div>
      </div>

      {/* Scope note */}
      <div className="mt-10 border-t border-observatory-border pt-8">
        <p className="mb-3 font-mono text-xs tracking-wider text-text-muted">
          ASSISTANT SCOPE — Intelligence Systems Analyst Skill v1.0
        </p>
        <div className="grid gap-3 text-xs text-text-muted sm:grid-cols-2">
          {[
            ['Signal queries', 'Browse and filter Observatory signals by category, score, or entity'],
            ['Event lookups', 'Retrieve events and their impact assessments'],
            ['Entity research', 'Explore what the Observatory knows about specific companies or models'],
            ['Historical context', 'Query signal and event history for a specific topic or time period'],
          ].map(([title, desc]) => (
            <div key={title} className="border border-observatory-border p-3">
              <p className="mb-1 font-medium text-text-secondary">{title}</p>
              <p>{desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
