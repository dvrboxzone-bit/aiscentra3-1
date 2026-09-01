import type { Metadata } from 'next'
import { ContactForm } from './contact-form'

export const metadata: Metadata = {
  title: 'Contact',
  description:
    "Questions about a Signal, a correction, or a partnership inquiry — write directly, no contact form middleman. AIscentra is run by one person; you'll get a real reply, not an auto-response.",
}

/**
 * AIscentra — /contact page. Real form (ContactForm, client component)
 * sends a genuine email via POST /api/contact -> Resend. Same visual
 * language and same real input/button classes (observatory-input,
 * btn-pill) already used elsewhere on the site (e.g. the homepage's
 * own Assistant query form) -- no new design system introduced, and
 * the same responsive breakpoints those existing forms already use,
 * so mobile behavior matches the rest of the site without new
 * mobile-specific code.
 */
export default function ContactPage(): React.JSX.Element {
  return (
    <>
      <section className="textured-bg px-6 pb-24 pt-40">
        <div className="tech-grid" />
        <div className="relative z-10 mx-auto max-w-[640px]">
          <span className="font-caption mb-4 block text-mint-signal">GET IN TOUCH</span>
          <h1 className="font-display mb-6 text-[10vw] text-frost md:text-[56px]">Contact.</h1>
          <p className="mb-10 text-lg text-silver-haze">
            Questions, corrections, or feedback about a signal? Send a message below, or email{' '}
            <a href="mailto:aiscentra@gmail.com" className="text-mint-signal hover:underline">
              aiscentra@gmail.com
            </a>{' '}
            directly.
          </p>
          <ContactForm />
        </div>
      </section>
    </>
  )
}
