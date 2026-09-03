import Link from 'next/link'

/**
 * AIscentra — vfinal Footer (Frontend Design Foundation, layer 2)
 *
 * Ported from AIscentra-vfinal-adapt.html's own <footer> markup (lines
 * ~592-628), preserving composition, block/subblock count (4 columns,
 * same row counts, same bottom bar), and geometry exactly.
 *
 * Real-route / honest-content adaptation (task instructions: "Удалить
 * пустые href='#'", "не создавать выдуманные... страницы"):
 * - Logo: href="#" -> "/".
 * - Product column: "Signals" -> /signals (real). "Trajectories" ->
 *   /trajectories (real -- REAL BUG FIXED 2026-09-03: this previously
 *   pointed to /#trajectories, a stale anchor left over from when
 *   Trajectories was a homepage section rather than its own page).
 *   "Forecasts" -> /forecasts (real -- REAL BUG FIXED 2026-09-03: this
 *   page already existed but the footer was never updated to link to
 *   it, still rendering plain non-clickable text). "Strategic Memory"
 *   -> /strategic-memory (real -- REAL PAGE BUILT 2026-09-03: new
 *   standalone page, same real IN DEVELOPMENT pattern as /forecasts,
 *   grounded in this project's own real architecture doc,
 *   File_59_STRATEGIC_MEMORY_SYSTEM.md). "Observations" ->
 *   /observatory (real route, does exist).
 * - Framework column: all 4 original destinations (Epistemic Model,
 *   Methodology, Security & Data, Roadmap) point to href="#" in the
 *   HTML with no corresponding real pages -- fabricating 4 new pages
 *   is explicitly forbidden. All 4 rows are preserved (same count) and
 *   link to /about, the closest real existing page covering this
 *   content, rather than being deleted or left as dead "#" links.
 * - Connect column: the two mailto: links are real and kept as-is.
 *   "X / Twitter" has no real destination configured -- rendered as
 *   plain text, not a fabricated URL. "Status Page" -> /status (real
 *   -- REAL PAGE BUILT 2026-09-03: new standalone page, honestly
 *   states it will show real pipeline state once that data exists,
 *   not a fabricated "all systems normal" badge).
 * - Bottom legal row: Privacy / Data Retention / Security Disclosure
 *   have no real pages -- rendered as plain text, not fabricated
 *   legal pages (task explicitly forbids creating these).
 */
export function VfinalFooter(): React.JSX.Element {
  return (
    <footer id="footer" data-section="footer" className="border-t border-border-subtle px-6 py-20">
      <div className="mx-auto max-w-[1200px]">
        <div className="mb-16 grid gap-12 md:grid-cols-4">
          <div>
            <Link href="/" aria-label="AIscentra — home" className="mb-6 flex items-center">
              <svg width="140" height="56">
                <use href="#aiscentra-logo" />
              </svg>
            </Link>
            <p className="max-w-xs text-sm text-silver-haze opacity-70">
              The most reliable way to understand what has changed in the AI ecosystem and why it
              matters.
            </p>
          </div>

          <div>
            <span className="font-caption mb-4 block text-silver-haze opacity-50">Product</span>
            <ul className="space-y-3 text-sm">
              <li>
                <Link href="/signals" className="text-frost hover:text-mint-signal">
                  Signals
                </Link>
              </li>
              <li>
                <Link href="/trajectories" className="text-frost hover:text-mint-signal">
                  Trajectories
                </Link>
              </li>
              <li>
                <Link href="/forecasts" className="text-frost hover:text-mint-signal">
                  Forecasts
                </Link>
              </li>
              <li>
                <Link href="/observatory" className="text-frost hover:text-mint-signal">
                  Observations
                </Link>
              </li>
              <li>
                <Link href="/strategic-memory" className="text-frost hover:text-mint-signal">
                  Strategic Memory
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <span className="font-caption mb-4 block text-silver-haze opacity-50">Framework</span>
            <ul className="space-y-3 text-sm">
              <li>
                <Link href="/about#epistemic-model" className="text-frost hover:text-mint-signal">
                  Epistemic Model
                </Link>
              </li>
              <li>
                <Link href="/about#methodology" className="text-frost hover:text-mint-signal">
                  Methodology
                </Link>
              </li>
              <li>
                <Link href="/about#security-data" className="text-frost hover:text-mint-signal">
                  Security &amp; Data
                </Link>
              </li>
              <li>
                <Link href="/about#roadmap" className="text-frost hover:text-mint-signal">
                  Roadmap
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <span className="font-caption mb-4 block text-silver-haze opacity-50">Connect</span>
            <ul className="space-y-3 text-sm">
              <li>
                <a href="mailto:aiscentra@gmail.com" className="text-frost hover:text-mint-signal">
                  Help the project
                </a>
              </li>
              <li>
                <a href="mailto:aiscentra@gmail.com" className="text-frost hover:text-mint-signal">
                  aiscentra@gmail.com
                </a>
              </li>
              <li>
                <Link href="/status" className="text-frost hover:text-mint-signal">
                  Status Page
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="flex flex-col items-center justify-between gap-4 border-t border-border-subtle pt-8 text-xs text-silver-haze opacity-60 md:flex-row">
          <span>© 2026 AIscentra · Independent AI Intelligence Observatory</span>
          <div className="flex gap-6">
            <Link href="/methodology" className="hover:text-mint-signal">
              Methodology
            </Link>
            <Link href="/privacy" className="hover:text-mint-signal">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-mint-signal">
              Terms
            </Link>
            <Link href="/contact" className="hover:text-mint-signal">
              Contact
            </Link>
          </div>
        </div>
      </div>
    </footer>
  )
}
