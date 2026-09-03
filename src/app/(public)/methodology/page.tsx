import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Methodology',
  description:
    'How a raw observation becomes a published Signal: the filters it must pass, the evidence it must carry, and the exact point where AIscentra rejects more candidates than it publishes.',
}

/**
 * AIscentra — /methodology page. Real, standalone legal/transparency
 * page (not a fabricated destination) -- text content specified
 * verbatim by the owner. Minimal individual-project legal contour, no
 * company/VAT claims per the owner's own explicit scope.
 */
export default function MethodologyPage(): React.JSX.Element {
  return (
    <>
      <section className="textured-bg px-6 pb-24 pt-40">
        <div className="tech-grid" />
        <div className="relative z-10 mx-auto max-w-[760px]">
          <span className="font-caption mb-4 block text-mint-signal">FRAMEWORK</span>
          <h1 className="font-display mb-12 text-[10vw] text-frost md:text-[56px]">Methodology.</h1>
          <div className="space-y-6 text-lg leading-relaxed text-silver-haze">
            <p>
              AIscentra monitors publicly available information about artificial intelligence,
              including official announcements, technical documentation, research publications,
              reputable reporting, and open-source project updates.
            </p>
            <p>
              Signals are selected for relevance, novelty, potential impact, and source reliability.
              Each published signal includes source links and publication context where available.
            </p>
            <p>
              AI-assisted processing may be used for classification, summarization, and analysis.
              Published material may be corrected, updated, or removed when new evidence emerges.
            </p>
            <p>
              Forecasts and trajectories represent analytical scenarios, not statements of fact or
              guarantees of future outcomes.
            </p>
          </div>

          {/* REAL, DETAILED WALKTHROUGH ADDED (explicit owner
              instruction, 2026-09-03): the four paragraphs above were
              specified verbatim by the owner and stay untouched. This
              section extends the page with a real, concrete
              description of the pipeline itself, grounded in this
              project's own real architecture documents
              (File_45_SIGNAL_GENERATION_PIPELINE.md,
              File_03_SIGNAL_SPECIFICATION.md) -- describes what the
              system is built to do, not a claim about current
              operational volume or scale (that distinction matters:
              this page is about method, not a status report). */}
          <div className="mt-16 space-y-10 border-t border-border-subtle pt-16">
            <div>
              <h2 className="font-display mb-4 text-2xl text-frost">
                From a raw mention to a published Signal
              </h2>
              <p className="text-lg leading-relaxed text-silver-haze">
                Most of what crosses our desk never becomes a Signal. A document comes in from a
                source, gets cleaned up and normalized, and only then does the real filtering start:
                does this actually say something new, or is it a rewrite of something we already
                have? Does it overlap with anything already in the record? If it survives that, it
                moves to analysis — what&rsquo;s the actual claim here, and how much does it matter.
                Only after that does a candidate get scored, checked for consistency, and either
                published or set aside. Nothing skips ahead in that order.
              </p>
            </div>

            <div>
              <h2 className="font-display mb-4 text-2xl text-frost">
                What we ask before publishing anything
              </h2>
              <p className="mb-4 text-lg leading-relaxed text-silver-haze">
                Before a Signal goes live, a handful of plain questions have to hold up:
              </p>
              <ul className="list-inside list-disc space-y-2 text-lg leading-relaxed text-silver-haze">
                <li>Is the source actually credible?</li>
                <li>Is this genuinely new, or just a repeat?</li>
                <li>Does it connect to something already on the record?</li>
                <li>Will this still matter in six months?</li>
              </ul>
              <p className="mt-4 text-lg leading-relaxed text-silver-haze">
                If most of the answers are no, we don&rsquo;t publish it. That&rsquo;s not a
                formality — it&rsquo;s the actual reason most candidates never make it to the site.
              </p>
            </div>

            <div>
              <h2 className="font-display mb-4 text-2xl text-frost">What counts as evidence</h2>
              <p className="text-lg leading-relaxed text-silver-haze">
                We weigh evidence by what kind it is, not by how much of it there is. A scientific
                paper, an official announcement, real repository activity, a regulatory filing —
                these carry weight on their own. Five outlets repeating the same press release
                don&rsquo;t add up to five confirmations; they&rsquo;re one claim, said five times.
                An independent source saying something different from the crowd doesn&rsquo;t get
                discarded for being outnumbered — it gets marked and watched.
              </p>
            </div>

            <div>
              <h2 className="font-display mb-4 text-2xl text-frost">
                Fact, interpretation, and what comes next
              </h2>
              <p className="text-lg leading-relaxed text-silver-haze">
                A Signal is written to keep two things separate: what actually happened, and what we
                think it means. &ldquo;A lab released a new model&rdquo; is a fact. &ldquo;This
                probably signals a shift toward smaller, cheaper models&rdquo; is analysis — our
                read on it, not a certainty. We try never to let the second one borrow the
                confidence of the first.
              </p>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
