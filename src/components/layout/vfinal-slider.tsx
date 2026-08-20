import { VfinalImageSlot } from './vfinal-image-slot'
import type { LandingAsset } from './vfinal-landing-assets'

/**
 * AIscentra — vfinal image slider (Frontend Design Foundation, layer 4
 * correction)
 *
 * REAL BUG FIXED (independent review): the canonical HTML source's own
 * History section has TWO `.slider-container` blocks, each containing
 * TWO `.slider-slide` images (four total), animated via the existing
 * `slideFade 10s infinite linear` keyframe already defined in
 * globals.css (layer 1, `.slider-slide { animation: vf-slideFade 10s
 * infinite linear; }` with staggered `animation-delay` on the second
 * child) -- a real fade-crossover slider, not a single static image. A
 * prior version of the homepage collapsed each of these into one
 * static VfinalImageSlot, silently reducing the block/subblock count.
 *
 * This component restores the exact structure: reuses the SAME
 * existing `.slider-container`/`.slider-slide` CSS (no new animation
 * logic invented, no button/JS-driven controls -- the task explicitly
 * says to use the existing slider CSS as-is, not fabricate manual
 * navigation), with two approved local assets as its two slides.
 */
export function VfinalSlider({
  assets,
  className = '',
}: {
  assets: readonly [LandingAsset, LandingAsset]
  className?: string
}): React.JSX.Element {
  return (
    <div className={`overflow-hidden bg-deep-obsidian ${className}`}>
      <div className="slider-container group">
        <div className="slider-slide">
          <VfinalImageSlot asset={assets[0]} className="h-full w-full border-0" />
        </div>
        <div className="slider-slide">
          <VfinalImageSlot asset={assets[1]} className="h-full w-full border-0" />
        </div>
      </div>
    </div>
  )
}
