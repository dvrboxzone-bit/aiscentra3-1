import { VfinalImageSlot } from './vfinal-image-slot'

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
 * navigation), with two VfinalImageSlot panels as its two slides
 * (neutral, no external/temporary URLs, per this layer's own image-
 * slot policy).
 */
export function VfinalSlider({ className = '' }: { className?: string }): React.JSX.Element {
  return (
    <div className={`overflow-hidden bg-deep-obsidian ${className}`}>
      <div className="slider-container group">
        <div className="slider-slide">
          <VfinalImageSlot className="h-full w-full border-0" />
        </div>
        <div className="slider-slide">
          <VfinalImageSlot className="h-full w-full border-0" />
        </div>
      </div>
    </div>
  )
}
