import { VfinalImageSlot } from './vfinal-image-slot'
import type { LandingAsset } from './vfinal-landing-assets'

/**
 * AIscentra — 8-image cycling slider for the compact History block on
 * the homepage (explicit owner instruction, 2026-09-05).
 *
 * The homepage History block previously showed two separate
 * 2-image sliders (one per detail card). Those cards are now moved to
 * their own dedicated article page -- this single remaining window
 * cycles through all 8 real history images instead, using the new,
 * separate `.slider8-container`/`.slider8-slide` CSS (globals.css) --
 * same real fade math as the existing 2-image `VfinalSlider`
 * (1s fade-in, 4s hold, 1s fade-out per slide), just extended to 8
 * positions on a 40s loop instead of 2 positions on a 10s loop. The
 * existing 2-image VfinalSlider component and its own CSS are
 * completely untouched -- this is a new, separate component, not a
 * generalization of the old one, since the old one is reused
 * elsewhere with a fixed, real 2-image contract.
 */
export function VfinalSlider8({
  assets,
  className = '',
}: {
  assets: readonly LandingAsset[]
  className?: string
}): React.JSX.Element {
  return (
    <div className={`overflow-hidden bg-deep-obsidian ${className}`}>
      <div className="slider8-container group">
        {assets.map((asset) => (
          <div key={asset.src} className="slider8-slide">
            <VfinalImageSlot asset={asset} className="h-full w-full border-0" />
          </div>
        ))}
      </div>
    </div>
  )
}
