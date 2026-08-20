import type { LandingAsset } from './vfinal-landing-assets'

export function VfinalImageSlot({
  asset,
  className = '',
}: {
  asset?: LandingAsset
  className?: string
}): React.JSX.Element {
  if (!asset) {
    return (
      <div
        className={`img-mono flex items-center justify-center bg-surface-tonal ${className}`}
        data-image-slot="neutral-placeholder"
        role="img"
        aria-label="Image not yet available"
      />
    )
  }

  return (
    <div
      className={`relative overflow-hidden bg-surface-tonal ${className}`}
      data-image-slot="local-asset"
      data-asset-path={asset.src}
      data-asset-purpose={asset.purpose}
    >
      {/* Approved local assets intentionally bypass image optimization so the Preview request is
          the exact versioned WebP path from the asset map. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={asset.src}
        alt={asset.alt}
        loading="lazy"
        decoding="async"
        className="img-mono h-full w-full object-cover"
      />
    </div>
  )
}
