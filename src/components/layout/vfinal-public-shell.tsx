import { VfinalLogoSymbol } from './vfinal-logo-symbol'
import { VfinalHeader } from './vfinal-header'
import { VfinalFooter } from './vfinal-footer'
import { VfinalLenisProvider } from './vfinal-lenis-provider'
import { VfinalProgressAndBackToTop } from './vfinal-progress-back-to-top'
import { VfinalInteractionController } from './vfinal-interaction-controller'
import { VfinalAssistantPanelProvider } from './vfinal-assistant-context'
import { VfinalAssistantPanel } from './vfinal-assistant-panel'

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
 * REAL BUG FIXED (independent review): <main> previously had its own
 * `pt-24` to account for VfinalHeader's `fixed` positioning -- but the
 * HTML source's own first section (#hero) already carries `pt-40` (see
 * AIscentra-vfinal-adapt.html line 284: `class="pt-40 pb-24 px-6
 * textured-bg relative"`), which is the ACTUAL mechanism the original
 * design uses to clear its fixed header. Adding pt-24 here on top of
 * that stacked a second, unintended vertical offset not present in the
 * approved design -- every page using this shell would have rendered
 * with extra top spacing the HTML never had. Removed entirely; each
 * migrated page's own first section supplies whatever top padding the
 * HTML source specifies for it (pt-40 for #hero specifically, verified
 * per-page as each one migrates in layers 4-6).
 *
 * Layer 3 global interactive chrome, page-independent in the HTML
 * source (VfinalLenisProvider, VfinalProgressAndBackToTop) is mounted
 * here so every page adopting this shell gets it automatically, exactly
 * matching the HTML's own single top-level placement of these elements
 * right after <body>.
 */
export function VfinalPublicShell({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <VfinalAssistantPanelProvider>
      <div className="min-h-screen bg-deep-obsidian text-frost">
        <VfinalLenisProvider />
        <VfinalInteractionController />
        <VfinalProgressAndBackToTop />
        <VfinalLogoSymbol />
        <VfinalHeader />
        <main>{children}</main>
        <VfinalFooter />
        <VfinalAssistantPanel />
      </div>
    </VfinalAssistantPanelProvider>
  )
}
