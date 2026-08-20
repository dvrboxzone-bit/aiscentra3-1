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
 * - Product column: "Signals" -> /signals (real). "Forecasts" and
 *   "Observations"/"Strategic Memory": no dedicated route/section
 *   exists yet for these as standalone destinations -- rendered as
 *   plain, non-clickable text (not <a href="#">, not a fabricated
 *   route) so the subblock/row itself is preserved but never lies
 *   about being a working link. "Observations" -> /observatory (real
 *   route, does exist).
 * - Framework column: all 4 original destinations (Epistemic Model,
 *   Methodology, Security & Data, Roadmap) point to href="#" in the
 *   HTML with no corresponding real pages -- fabricating 4 new pages
 *   is explicitly forbidden. All 4 rows are preserved (same count) and
 *   link to /about, the closest real existing page covering this
 *   content, rather than being deleted or left as dead "#" links.
 * - Connect column: the two mailto: links are real and kept as-is.
 *   "X / Twitter" and "Status Page" have no real destination
 *   configured -- rendered as plain text, not fabricated URLs.
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
            <Link
              href="/"
              className="mb-6 flex items-center gap-4 text-lg font-bold tracking-tight text-frost"
            >
              <svg width="48" height="48">
                <use href="#aiscentra-logo" />
              </svg>
              <span>AIscentra</span>
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
                <Link href="/#trajectories" className="text-frost hover:text-mint-signal">
                  Trajectories
                </Link>
              </li>
              <li>
                <span className="text-silver-haze opacity-50" title="In development">
                  Forecasts
                </span>
              </li>
              <li>
                <Link href="/observatory" className="text-frost hover:text-mint-signal">
                  Observations
                </Link>
              </li>
              <li>
                <span
                  className="text-silver-haze opacity-50"
                  title="Not yet available as a standalone page"
                >
                  Strategic Memory
                </span>
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
                <a
                  href="mailto:contact@aiscentra.com"
                  className="text-frost hover:text-mint-signal"
                >
                  Help the project
                </a>
              </li>
              <li>
                <a
                  href="mailto:contact@aiscentra.com"
                  className="text-frost hover:text-mint-signal"
                >
                  contact@aiscentra.com
                </a>
              </li>
              <li>
                <span className="text-silver-haze opacity-50" title="Not yet available">
                  X / Twitter
                </span>
              </li>
              <li>
                <span className="text-silver-haze opacity-50" title="Not yet available">
                  Status Page
                </span>
              </li>
            </ul>
          </div>
        </div>

        <div className="flex flex-col items-center justify-between gap-4 border-t border-border-subtle pt-8 text-xs text-silver-haze opacity-60 md:flex-row">
          <span>© 2026 AIscentra. Intelligence Observatory.</span>
          <div className="flex gap-6">
            <span title="Not yet available">Privacy</span>
            <span title="Not yet available">Data Retention</span>
            <span title="Not yet available">Security Disclosure</span>
          </div>
        </div>
      </div>
    </footer>
  )
}
