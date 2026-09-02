import type { Metadata } from 'next'
import { TRAJECTORIES } from '@/lib/trajectories'
import { TrajectoryTable } from './trajectory-table'

export const metadata: Metadata = {
  title: 'Trajectories',
  description:
    'A canonical registry of AI ecosystem companies — founded, founders, country, sphere, and current status, each independently verified.',
}

/**
 * AIscentra — /trajectories page (registry table, explicit owner
 * instruction, 2026-09-02).
 *
 * Replaces the earlier 6-card layout with a real table of all 73
 * entities from AIscentra_TRAJECTORIES_REGISTRY_v0_2.md (owner-
 * provided, independently source-verified document -- see that
 * document's own "Critical corrections" and evidence sections). Not
 * paginated across separate pages -- shown 36 rows at a time with an
 * explicit "show all" reveal (see trajectory-table.tsx), matching the
 * owner's own explicit preference for this registry's bounded size.
 *
 * Same visual language already established elsewhere on this site
 * (textured-bg + tech-grid, one large block hosting all real content)
 * -- not a new pattern invented for this page.
 */
export default function TrajectoriesPage(): React.JSX.Element {
  return (
    <section className="textured-bg px-6 pb-24 pt-40">
      <div className="tech-grid" />
      <div className="relative z-10 mx-auto max-w-[1200px]">
        <span className="font-caption mb-8 block text-mint-signal">TRAJECTORIES</span>
        <h1 className="font-display mb-8 text-[12vw] text-frost md:text-[100px]">
          Company registry.
        </h1>
        <p className="mb-16 max-w-2xl text-lg leading-relaxed text-silver-haze">
          A canonical list of {TRAJECTORIES.length} companies shaping the AI ecosystem — frontier
          labs, generative media, coding agents, infrastructure, biotech, robotics, and defence.
          This is not a ranking: order follows category, not any notion of importance. Every
          founding date, founder list, and current status here is independently checked against a
          primary source before publication — where a source describes a founding team rather than a
          single name, we say so, rather than inventing a simpler story.
        </p>

        <TrajectoryTable entities={TRAJECTORIES} />
      </div>
    </section>
  )
}
