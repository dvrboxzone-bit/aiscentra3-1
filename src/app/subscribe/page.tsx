import type { Metadata } from 'next'
import { VfinalPublicShell } from '@/components/layout/vfinal-public-shell'
import { SubscribeForm } from './subscribe-form'

export const metadata: Metadata = {
  title: 'Subscribe',
  description:
    'Get new AIscentra Signals, Forecasts, or project news delivered to your inbox — free.',
}

/**
 * AIscentra — /subscribe page. Real form (SubscribeForm, client
 * component) creates/updates a real Resend Contact via
 * POST /api/subscribe, opting the contact into whichever of the 3
 * real Resend Topics (Signals, Forecasts, Project News) the visitor
 * checked. Same real visual language, same real observatory-input/
 * btn-pill classes and Cloudflare Turnstile pattern already
 * established by /contact -- no new design system introduced.
 */
export default function SubscribePage(): React.JSX.Element {
  return (
    <VfinalPublicShell>
      <section className="textured-bg px-6 pb-24 pt-40">
        <div className="tech-grid" />
        <div className="relative z-10 mx-auto max-w-[640px]">
          <span className="font-caption mb-4 block text-mint-signal">STAY INFORMED</span>
          <h1 className="font-display mb-6 text-[10vw] text-frost md:text-[56px]">Subscribe.</h1>
          <p className="mb-10 text-lg text-silver-haze">
            Choose what you&apos;d like delivered to your inbox. Everything below is free — no
            payment, no account required. You can unsubscribe from any list at any time, with one
            click, directly from any email you receive.
          </p>
          <SubscribeForm />
        </div>
      </section>
    </VfinalPublicShell>
  )
}
