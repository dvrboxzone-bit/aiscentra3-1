'use client'

import { useState } from 'react'
import type { TrajectoryEntity } from '@/lib/trajectories'
import { TrajectoryLogo } from './trajectory-logo'

const INITIAL_VISIBLE_COUNT = 36

/**
 * AIscentra — Trajectories registry table (explicit owner instruction,
 * 2026-09-02): a real 73-row table, not paginated across separate
 * pages (owner's own explicit preference given the registry's
 * intentionally bounded size -- see the source registry document's own
 * "I would not expand this list now to 200-500 companies" editorial
 * position). Shows the first 36 rows; a real, explicit toggle reveals
 * the remaining 37 -- not a separate route, not infinite scroll, a
 * plain, honest client-side reveal.
 *
 * Client Component (not the parent Server Component page) because the
 * expand/collapse state is real interactive UI state that must live in
 * the browser.
 */
export function TrajectoryTable({
  entities,
}: {
  entities: readonly TrajectoryEntity[]
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? entities : entities.slice(0, INITIAL_VISIBLE_COUNT)
  const hiddenCount = entities.length - INITIAL_VISIBLE_COUNT

  return (
    <div>
      <div className="overflow-x-auto border border-border-subtle">
        <table className="w-full min-w-[900px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-border-subtle text-mint-signal">
              <th className="font-caption whitespace-nowrap px-4 py-3 font-normal">Company</th>
              <th className="font-caption whitespace-nowrap px-4 py-3 font-normal">Founded</th>
              <th className="font-caption px-4 py-3 font-normal">Founders</th>
              <th className="font-caption whitespace-nowrap px-4 py-3 font-normal">Country</th>
              <th className="font-caption px-4 py-3 font-normal">Sphere</th>
              <th className="font-caption px-4 py-3 font-normal">Status</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((entity) => (
              <tr
                key={entity.name}
                className="border-b border-border-subtle/50 align-top text-silver-haze last:border-b-0"
              >
                <td className="whitespace-nowrap px-4 py-3">
                  <div className="flex items-center gap-3">
                    <TrajectoryLogo domain={entity.domain} name={entity.name} />
                    <span className="text-frost">{entity.name}</span>
                  </div>
                </td>
                <td className="whitespace-nowrap px-4 py-3">{entity.founded}</td>
                <td className="px-4 py-3">{entity.founders}</td>
                <td className="whitespace-nowrap px-4 py-3">{entity.country}</td>
                <td className="px-4 py-3">{entity.sphere}</td>
                <td className="px-4 py-3">{entity.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="font-caption mt-6 flex items-center gap-2 text-mint-signal transition-colors hover:text-frost"
          aria-expanded={expanded}
        >
          {expanded ? 'Show fewer' : `Show all ${entities.length} entities (+${hiddenCount})`}
          <span aria-hidden="true">{expanded ? '↑' : '↓'}</span>
        </button>
      )}
    </div>
  )
}
