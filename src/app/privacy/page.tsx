import type { Metadata } from 'next'
import { VfinalPublicShell } from '@/components/layout/vfinal-public-shell'

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'How AIscentra handles technical and personal information.',
}

/**
 * AIscentra — /privacy page. Real, minimal privacy notice for an
 * individual-operated project with no accounts, subscriptions,
 * newsletters, or forms -- text specified verbatim by the owner.
 * Honest about the ONLY real technical processing (infrastructure
 * logs) -- must be updated the moment a new tracking/analytics/form
 * service is genuinely added, not before.
 */
export default function PrivacyPage(): React.JSX.Element {
  return (
    <VfinalPublicShell>
      <section className="textured-bg px-6 pb-24 pt-40">
        <div className="tech-grid" />
        <div className="relative z-10 mx-auto max-w-[760px]">
          <span className="font-caption mb-4 block text-mint-signal">LEGAL</span>
          <h1 className="font-display mb-4 text-[10vw] text-frost md:text-[56px]">
            Privacy Policy.
          </h1>
          <p className="font-caption mb-12 text-silver-haze">Last updated: August 23, 2026</p>
          <div className="space-y-6 text-lg leading-relaxed text-silver-haze">
            <p>AIscentra is an independent online project operated by an individual.</p>
            <p>AIscentra does not currently provide user accounts or paid subscriptions.</p>
            <p>
              If you subscribe to receive email updates (Signals, Forecasts, or project news), we
              store your email address and your chosen list preferences solely to send these
              updates. This is entirely free — no payment is required. Your email is processed by
              Resend, our email delivery provider, acting on our behalf; we do not sell or share it
              with any other third party. You can unsubscribe from any list at any time, with one
              click, using the link included in every email you receive, or by contacting us at{' '}
              <a href="mailto:aiscentra@gmail.com" className="text-mint-signal hover:underline">
                aiscentra@gmail.com
              </a>
              .
            </p>
            <p>
              The website may process limited technical information required for its operation and
              security, such as server logs, IP address, browser type, device information, and
              request timestamps. This information may be processed by infrastructure providers used
              to operate the website.
            </p>
            <p>AIscentra does not sell personal data.</p>
            <p>
              If you contact AIscentra by email, your email address and message will be used only to
              respond to your request.
            </p>
            <p>
              For privacy questions or data deletion requests, contact:{' '}
              <a href="mailto:aiscentra@gmail.com" className="text-mint-signal hover:underline">
                aiscentra@gmail.com
              </a>
            </p>
          </div>
        </div>
      </section>
    </VfinalPublicShell>
  )
}
