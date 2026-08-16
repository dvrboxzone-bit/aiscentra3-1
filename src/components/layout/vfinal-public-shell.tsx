import { VfinalLogoSymbol } from './vfinal-logo-symbol'
import { VfinalHeader } from './vfinal-header'
import { VfinalFooter } from './vfinal-footer'

/**
 * AIscentra — vfinal public shell (Frontend Design Foundation, layer 2)
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
 * Lenis smooth-scroll, the scroll progress bar, and the back-to-top
 * button (all global, page-independent interactive chrome in the HTML
 * source) arrive in layer 3 and will be added to this same shell then.
 */
export function VfinalPublicShell({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="min-h-screen bg-deep-obsidian text-frost">
      <VfinalLogoSymbol />
      <VfinalHeader />
      <main className="pt-24">{children}</main>
      <VfinalFooter />
    </div>
  )
}
