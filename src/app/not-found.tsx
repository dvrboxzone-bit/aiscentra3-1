import Link from 'next/link'
import { VfinalPublicShell } from '@/components/layout/vfinal-public-shell'

/**
 * AIscentra — vfinal 404 not-found state (Frontend Design Foundation,
 * layer 5C). Real, working return-home link (href="/", a genuine
 * route) -- not href="#". Same shared header/footer as every real
 * page.
 */
export default function NotFound(): React.JSX.Element {
  return (
    <VfinalPublicShell>
      <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
        <span className="font-caption mb-2 text-silver-haze">OBSERVATORY SIGNAL</span>
        <h1 className="font-display mb-2 text-6xl text-frost">404</h1>
        <p className="mb-8 text-silver-haze">This signal was not detected in the Observatory.</p>
        <Link href="/" className="arrow-link magnetic">
          Return to Observatory <span>→</span>
        </Link>
      </div>
    </VfinalPublicShell>
  )
}
