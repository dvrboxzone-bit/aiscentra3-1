import type { Metadata } from 'next'
import { VfinalImageSlot } from '@/components/layout/vfinal-image-slot'
import { assetAt, HISTORY_ASSETS } from '@/components/layout/vfinal-landing-assets'

export const metadata: Metadata = {
  title: 'The Convergence — AIscentra Editorial',
  description:
    'How artificial intelligence emerged: not a single invention, but a convergence of independent ideas across 1943, 1950, and 1956.',
}

/**
 * AIscentra — /editorial/the-convergence (explicit owner instruction,
 * 2026-09-05). Full version of the homepage's compact "05 — Signal
 * 001 / The Convergence" teaser -- the two detail cards that used to
 * live directly on the homepage move here, expanded into a full,
 * properly-paragraphed article, with a real, added McCulloch-Pitts
 * (1943) section (explicit owner approval: "если нужно то добавить")
 * so the article's own "Minimal Timeline" (1943 -> 1950 -> 1956) has
 * three real sections, not two plus a passing mention.
 *
 * Every real image used (all 8 real assets in HISTORY_ASSETS) is
 * placed STATICALLY here, one per its own correct place in the text
 * -- explicit owner instruction: no cycling/sliding animation on the
 * article page itself, unlike the homepage's own compact teaser
 * (which does cycle all 8 in one small window). Two of these eight
 * (Turing's own 1951 portrait, and the real scanned opening page of
 * his 1950 Mind paper) were previously unused, generic-labelled
 * assets on this project's own real asset map -- now given real,
 * accurate alt text (see vfinal-landing-assets.ts) and used here for
 * the first time, exactly where they belong.
 *
 * Sources: a compact row of real domain favicons linking out, not the
 * original 27-entry list (which repeated the same handful of real
 * domains many times over with different anchor text for the same
 * underlying fact) -- deduplicated to the distinct, real sources this
 * article's own claims are actually drawn from.
 */
export default function TheConvergencePage(): React.JSX.Element {
  const sources = [
    {
      name: 'Wikipedia',
      url: 'https://en.wikipedia.org/wiki/Computing_Machinery_and_Intelligence',
    },
    { name: 'IBM', url: 'https://www.ibm.com/think/topics/history-of-artificial-intelligence' },
    {
      name: 'Dartmouth College',
      url: 'https://home.dartmouth.edu/about/artificial-intelligence-ai-coined-dartmouth',
    },
    {
      name: 'Mind (Oxford Academic)',
      url: 'https://academic.oup.com/mind/article-abstract/LIX/236/433/986238',
    },
    {
      name: 'Stanford (jmc.stanford.edu)',
      url: 'http://jmc.stanford.edu/articles/dartmouth/dartmouth.pdf',
    },
    {
      name: 'History of Information',
      url: 'https://www.historyofinformation.com/detail.php?entryid=782',
    },
  ]

  return (
    <>
      <section className="textured-bg px-6 pb-24 pt-40">
        <div className="tech-grid" />
        <div className="relative z-10 mx-auto max-w-[760px]">
          <span className="font-caption mb-4 block text-mint-signal">05 — SIGNAL 001</span>
          <h1 className="font-display mb-10 text-[10vw] text-frost md:text-[64px]">
            The Convergence.
          </h1>
          <p className="font-caption mb-4 text-silver-haze">1943 → 1956</p>

          <p className="mb-10 text-lg leading-relaxed text-silver-haze">
            The emergence of artificial intelligence was not the result of a single invention. It
            was a convergence of independent theoretical developments, research communities, and
            methodological approaches that gradually aligned around a common question: whether
            intelligence could be treated as a computational object.
          </p>

          <div className="mb-12 overflow-hidden border border-border-subtle bg-surface-tonal">
            <VfinalImageSlot asset={assetAt(HISTORY_ASSETS, 0)} className="aspect-[16/9] w-full" />
          </div>

          {/* REAL ADDITION — a third, equal section for 1943, matching
              this article's own "Minimal Timeline" further down, which
              already treats 1943 as a real, standalone point, not a
              detail folded into the 1956 section. */}
          <div className="mb-4 flex items-center gap-4">
            <span className="font-caption text-silver-haze">FACT</span>
            <span className="font-caption text-mint-signal">VERIFIED</span>
          </div>
          <h2 className="font-heading mb-6 text-3xl text-frost md:text-4xl">
            A logical calculus of nervous activity
          </h2>
          <p className="mb-6 leading-relaxed text-silver-haze">
            In 1943, Warren McCulloch and Walter Pitts published{' '}
            <em>&ldquo;A Logical Calculus of the Ideas Immanent in Nervous Activity.&rdquo;</em> The
            paper introduced a mathematical model of neurons as simple logical elements, capable of
            implementing arbitrary Boolean functions when connected into networks.
          </p>
          <p className="mb-10 leading-relaxed text-silver-haze">
            Building on Alan Turing&rsquo;s earlier work on computable numbers, the model showed
            that brain-like structures could, in principle, carry significant computational power
            &mdash; more than a decade before anyone would use the phrase &ldquo;artificial
            intelligence.&rdquo;
          </p>

          <div className="mb-12 overflow-hidden border border-border-subtle bg-surface-tonal">
            <VfinalImageSlot asset={assetAt(HISTORY_ASSETS, 1)} className="aspect-[16/9] w-full" />
          </div>

          <div className="mb-4 flex items-center gap-4">
            <span className="font-caption text-silver-haze">FACT</span>
            <span className="font-caption text-mint-signal">VERIFIED</span>
          </div>
          <h2 className="font-heading mb-6 text-3xl text-frost md:text-4xl">Can machines think?</h2>
          <p className="mb-6 leading-relaxed text-silver-haze">
            In 1950, the British mathematician Alan Turing published{' '}
            <em>&ldquo;Computing Machinery and Intelligence&rdquo;</em> in the journal <em>Mind</em>
            . It is widely regarded as the first systematic attempt to reformulate the question
            &ldquo;Can machines think?&rdquo; in operational, rather than purely philosophical,
            terms.
          </p>
          <p className="mb-6 leading-relaxed text-silver-haze">
            Turing introduced the &ldquo;imitation game,&rdquo; later known as the Turing test. The
            original setup involves three participants: a man, a woman, and an interrogator who is
            isolated from the other two and communicates with them only in writing, trying to
            determine which is which. Turing proposed replacing one human participant with a
            machine, and asking whether the machine could play the role as convincingly.
          </p>
          <p className="mb-10 leading-relaxed text-silver-haze">
            In this framework, &ldquo;thinking&rdquo; is defined not by internal mental states but
            by observable behaviour in a constrained communicative task. Turing did not claim to
            prove that machines think; he shifted the burden of proof, showing the question could be
            investigated empirically through computation and behaviour rather than settled by
            definition alone.
          </p>

          <div className="mb-12 grid grid-cols-2 gap-4">
            <div className="overflow-hidden border border-border-subtle bg-surface-tonal">
              <VfinalImageSlot asset={assetAt(HISTORY_ASSETS, 6)} className="aspect-[3/4] w-full" />
            </div>
            <div className="overflow-hidden border border-border-subtle bg-surface-tonal">
              <VfinalImageSlot asset={assetAt(HISTORY_ASSETS, 7)} className="aspect-[3/4] w-full" />
            </div>
          </div>

          <div className="mb-4 flex items-center gap-4">
            <span className="font-caption text-silver-haze">EVENT</span>
            <span className="font-caption text-mint-signal">CONVERGENCE</span>
          </div>
          <h2 className="font-heading mb-6 text-3xl text-frost md:text-4xl">
            Dartmouth, Summer 1956
          </h2>
          <p className="mb-6 leading-relaxed text-silver-haze">
            The Dartmouth Summer Research Project on Artificial Intelligence ran from 18 June to 17
            August 1956 at Dartmouth College. It was initiated by a proposal, dated 31 August 1955,
            written by John McCarthy, Marvin Minsky, Nathaniel Rochester, and Claude Shannon. The
            proposal&rsquo;s central hypothesis: &ldquo;every aspect of learning or any other
            feature of intelligence can in principle be so precisely described that a machine can be
            made to simulate it.&rdquo;
          </p>
          <p className="mb-6 leading-relaxed text-silver-haze">
            The Dartmouth workshop did not originate the ideas behind it &mdash; the McCulloch-Pitts
            model, Turing&rsquo;s own analysis of computable numbers, and early game-playing and
            logic programs already existed. Its real contribution was conceptual and institutional:
            it brought researchers from mathematics, computer science, neurophysiology, psychology,
            and engineering together under a shared label, and articulated a common research agenda.
          </p>
          <p className="mb-10 leading-relaxed text-silver-haze">
            Participants included John McCarthy, Marvin Minsky, Allen Newell, Herbert Simon, Arthur
            Samuel, Oliver Selfridge, and Ray Solomonoff, among others. Later historiography has
            called it the &ldquo;Constitutional Convention of AI&rdquo; &mdash; not because it
            generated every foundational idea, but because it established the field&rsquo;s
            disciplinary boundaries, terminology, and collective identity.
          </p>

          <div className="mb-12 grid grid-cols-2 gap-4">
            <div className="overflow-hidden border border-border-subtle bg-surface-tonal">
              <VfinalImageSlot asset={assetAt(HISTORY_ASSETS, 3)} className="aspect-[4/3] w-full" />
            </div>
            <div className="overflow-hidden border border-border-subtle bg-surface-tonal">
              <VfinalImageSlot asset={assetAt(HISTORY_ASSETS, 4)} className="aspect-[4/3] w-full" />
            </div>
          </div>

          <h2 className="font-heading mb-6 text-2xl text-frost">
            1943 → 1950 → 1956: a minimal timeline
          </h2>
          <ul className="mb-12 space-y-3 border-l-2 border-mint-signal pl-6 leading-relaxed text-silver-haze">
            <li>
              <strong className="text-frost">1943</strong> &mdash; McCulloch and Pitts publish a
              formal model of neural networks, showing networks of simple threshold units can
              implement arbitrary logical functions.
            </li>
            <li>
              <strong className="text-frost">1950</strong> &mdash; Turing publishes{' '}
              <em>Computing Machinery and Intelligence</em>, introducing the imitation game and
              reframing &ldquo;Can machines think?&rdquo; as an empirical question.
            </li>
            <li>
              <strong className="text-frost">1955</strong> &mdash; McCarthy, Minsky, Rochester, and
              Shannon circulate the Dartmouth proposal.
            </li>
            <li>
              <strong className="text-frost">1956</strong> &mdash; The Dartmouth workshop convenes,
              consolidating prior work under the name &ldquo;artificial intelligence.&rdquo;
            </li>
          </ul>

          <p className="mb-16 text-lg leading-relaxed text-silver-haze">
            This sequence is the convergence: from an abstract model of neural computation, through
            an operational criterion for machine intelligence, to an institutionalised research
            field with a shared vocabulary and agenda.
          </p>

          <div className="border-t border-border-subtle pt-6">
            <p className="font-caption mb-3 text-silver-haze">SOURCES</p>
            <div className="flex flex-wrap gap-3">
              {sources.map((s) => (
                <a
                  key={s.url}
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={s.name}
                  aria-label={s.name}
                  className="flex h-9 w-9 items-center justify-center border border-border-subtle bg-surface-tonal text-silver-haze transition-colors hover:border-mint-signal hover:text-mint-signal"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- external, unknown-dimension favicon. Deliberately simpler than trajectory-logo.tsx's own full 3-source fallback chain: only 6 well-known, high-authority domains here (Wikipedia, IBM, Dartmouth, Oxford Academic, Stanford, historyofinformation.com), a single Google favicon request is a reasonable, honest scope for this specific compact row */}
                  <img
                    src={`https://www.google.com/s2/favicons?domain=${new URL(s.url).hostname}&sz=32`}
                    alt=""
                    aria-hidden="true"
                    className="h-4 w-4"
                  />
                </a>
              ))}
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
