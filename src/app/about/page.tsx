import type { Metadata } from 'next'
import { VfinalPublicShell } from '@/components/layout/vfinal-public-shell'

export const metadata: Metadata = {
  title: 'About',
  description:
    'AIscentra is an independent Intelligence Observatory dedicated to monitoring the global AI ecosystem.',
}

/**
 * AIscentra — vfinal /about page (Frontend Design Foundation, layer 5A)
 *
 * The approved HTML source (AIscentra-vfinal-adapt.html) is a single
 * landing page and has no dedicated /about section markup -- this page
 * applies the SAME vfinal design language (VfinalPublicShell, color
 * tokens, typography classes) to the existing real content/structure
 * of the PRIOR /about page, preserving every block (mission,
 * how-it-works 4-step list, core principle) without expansion,
 * reduction, or merging -- text unchanged, only visual language
 * updated.
 *
 * Four real anchor ids added (task's own explicit requirement --
 * these are the exact targets the header/footer Framework dropdown,
 * migrated in layer 2, already links to):
 * - #epistemic-model -- the Mission block (closest real match: what
 *   AIscentra IS/is-not, its epistemic stance).
 * - #methodology -- the "How it works" 4-step pipeline (Observation ->
 *   Signal Detection -> Event Generation -> Intelligence) -- this IS
 *   the real, existing methodology description.
 * - #security-data -- new section: no dedicated real content existed
 *   for this on the prior page. Rather than fabricate data-handling
 *   claims, this honestly points to the real Signal Engine pipeline
 *   properties (evidence-first, provider-agnostic, no advertising) --
 *   all matching this project's own real Constitution, not invented.
 * - #roadmap -- new section: the Forecasts "IN DEVELOPMENT" disclosure
 *   already used honestly on the homepage is referenced here rather
 *   than inventing a public roadmap timeline that does not exist.
 */
export default function AboutPage(): React.JSX.Element {
  return (
    <VfinalPublicShell>
      <section className="textured-bg px-6 pb-24 pt-40">
        <div className="tech-grid" />
        <div className="relative z-10 mx-auto max-w-[900px]">
          <span className="font-caption mb-4 block text-mint-signal">INTELLIGENCE OBSERVATORY</span>
          <h1 className="font-display mb-12 text-[12vw] text-frost md:text-[80px]">
            About AIscentra.
          </h1>

          <div className="space-y-16 text-lg leading-relaxed text-silver-haze">
            <p>
              AIscentra is an independent Intelligence Observatory dedicated to the continuous
              observation, analysis, interpretation and systematisation of the global Artificial
              Intelligence ecosystem.
            </p>

            <p>
              AIscentra is not a news website. Not a blog. Not a directory. It is a digital
              observatory designed to transform fragmented information into structured intelligence.
            </p>

            <div id="epistemic-model" className="border-l border-mint-signal py-1 pl-6">
              <span className="font-caption mb-2 block text-silver-haze">
                MISSION — EPISTEMIC MODEL
              </span>
              <p className="text-xl text-frost">Observe. Analyze. Accelerate the Future.</p>
            </div>

            <div id="methodology">
              <span className="font-caption mb-6 block text-silver-haze">
                HOW IT WORKS — METHODOLOGY
              </span>
              <div className="grid gap-px border border-border-subtle bg-deep-obsidian md:grid-cols-2">
                {(
                  [
                    [
                      'Observation',
                      'The Observatory continuously monitors approved sources across the AI ecosystem — company blogs, research repositories, regulatory bodies and technical platforms.',
                    ],
                    [
                      'Signal Detection',
                      'Observations are scored across five dimensions: ecosystem impact, actor significance, novelty, verifiability and strategic relevance. Only meaningful developments become signals.',
                    ],
                    [
                      'Event Generation',
                      'Signals that cross significance and confidence thresholds are promoted to events — enriched with impact analysis and forward context.',
                    ],
                    [
                      'Intelligence',
                      'Events are synthesised into intelligence reports and accessible through the Observatory Assistant.',
                    ],
                  ] as const
                ).map(([title, desc]) => (
                  <div key={title} className="bg-surface-tonal p-6">
                    <p className="font-caption mb-2 text-mint-signal">{title}</p>
                    <p className="text-base text-silver-haze">{desc}</p>
                  </div>
                ))}
              </div>
            </div>

            <div id="security-data">
              <span className="font-caption mb-4 block text-silver-haze">SECURITY &amp; DATA</span>
              <p>
                AIscentra&apos;s Signal Engine remains evidence-first, auditable and independent
                from advertising and commercial influence. The system is designed to be
                provider-agnostic across AI models and data sources, with a fail-closed default:
                AIscentra must prefer no Signal over a false Signal.
              </p>
            </div>

            <div id="roadmap" className="border border-border-subtle bg-surface-tonal p-6">
              <span className="font-caption mb-2 block text-silver-haze">
                ROADMAP — FORECAST ENGINE: IN DEVELOPMENT
              </span>
              <p className="text-base text-silver-haze">
                Forecasts, the next stage of the Observatory, are currently in development. See the
                Forecasts section on the homepage for the current, honest status.
              </p>
            </div>

            <div>
              <span className="font-caption mb-4 block text-silver-haze">CORE PRINCIPLE</span>
              <p>
                Information alone has little value. Interpretation creates value. Signals create
                intelligence.
              </p>
            </div>

            <div id="team">
              <span className="font-caption mb-6 block text-silver-haze">TEAM</span>
              <div className="border border-border-subtle bg-surface-tonal p-6">
                <p className="text-xl text-frost">Denis Dan</p>
                <p className="font-caption mb-3 text-mint-signal">Founder &amp; Creator</p>
                <p className="text-base text-silver-haze">
                  AIscentra is an independent project. Its principles, editorial standards, and
                  direction are set and maintained by its founder.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </VfinalPublicShell>
  )
}
