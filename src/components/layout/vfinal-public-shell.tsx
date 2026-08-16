import { VfinalLogoSymbol } from './vfinal-logo-symbol'
import { VfinalHeader } from './vfinal-header'
import { VfinalFooter } from './vfinal-footer'
import { VfinalLenisProvider } from './vfinal-lenis-provider'
import { VfinalProgressAndBackToTop } from './vfinal-progress-back-to-top'

/**
 * AIscentra — vfinal public shell (Frontend Design Foundation, layer 2
 * + layer 3 global interactive chrome)
 *
 * The unified header + logo-symbol + footer wrapper every public page
 * adopts as it migrates to the new design (task requirement: "Каждая
 * страница должна получить единые header, главное меню и footer нового
 * дизайна"). NOT yet adopted by any real route -- individual pages
 * switch to this shell in later layers (4-6), one at a time, so no
 * not-yet-migrated page's current rendering changes as a side effect
 * of this component existing.
 *
 * `pt-24` on <main> accounts for VfinalHeader's own `fixed` positioning
 * (matches the HTML source's own spacing between its fixed header and
 * first section, verified against its own section padding values)
 * -- content is never hidden underneath the fixed header.
 *
 * Layer 3 global interactive chrome, page-independent in the HTML
 * source (VfinalLenisProvider, VfinalProgressAndBackToTop) is mounted
 * here so every page adopting this shell gets it automatically, exactly
 * matching the HTML's own single top-level placement of these elements
 * right after <body>.
 */
export function VfinalPublicShell({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="min-h-screen bg-deep-obsidian text-frost">
      <VfinalLenisProvider />
      <VfinalProgressAndBackToTop />
      <VfinalLogoSymbol />
      <VfinalHeader />
      <main className="pt-24">{children}</main>
      <VfinalFooter />
    </div>
  )
}
