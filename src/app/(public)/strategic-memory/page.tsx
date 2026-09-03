import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Strategic Memory',
  description:
    'AIscentra Strategic Memory will preserve validated conclusions that outlast individual signals — the institutional knowledge layer of the Observatory.',
}

/**
 * AIscentra — /strategic-memory page (explicit owner instruction,
 * 2026-09-03). Real, dedicated standalone page, replacing plain
 * non-clickable footer text with a real link and a real "coming soon"
 * page -- same established pattern as /forecasts, /editorial,
 * /emerging-patterns (textured-bg + tech-grid, IN DEVELOPMENT banner).
 *
 * Copy grounded in this project's own real architecture document
 * (File_59_STRATEGIC_MEMORY_SYSTEM.md): Strategic Memory is NOT the
 * same thing as a Signal -- it is the layer above Signals, storing
 * validated conclusions that remain useful for years, only promoted
 * after multiple independent Signals, time validation, and the
 * absence of strong contradictions. Deliberately does NOT promise
 * capabilities (search, contradiction tracking, versioning) this
 * project's own docs describe as real future architecture but not yet
 * built -- states the real principle honestly instead.
 */
export default function StrategicMemoryPage(): React.JSX.Element {
  return (
    <>
      <section className="textured-bg px-6 pb-24 pt-40">
        <div className="tech-grid" />
        <div className="relative z-10 mx-auto max-w-[640px]">
          <span className="font-caption mb-4 block text-mint-signal">WHAT OUTLASTS A SIGNAL</span>
          <h1 className="font-display mb-10 text-[10vw] text-frost md:text-[56px]">
            Strategic Memory.
          </h1>
          <p className="mb-10 text-lg text-silver-haze">
            Individual Signals are dynamic — new evidence can revise or retire them. Strategic
            Memory will store something different: conclusions that have been validated by multiple
            independent Signals over time, and that remain useful for years rather than days. It
            will only promote a conclusion once contradicting evidence has been checked for and not
            found — and it will keep every prior version, never silently rewriting what the
            Observatory believed before.
          </p>
          <div className="border border-border-subtle bg-surface-tonal p-6">
            <span className="font-caption block text-silver-haze">
              STRATEGIC MEMORY — IN DEVELOPMENT
            </span>
          </div>
        </div>
      </section>
    </>
  )
}
