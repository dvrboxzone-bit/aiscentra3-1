import type { SignalCategory } from '@/types/database'

export type LandingAssetPurpose = 'featured-signal' | 'forecast' | 'observation' | 'history'

export interface LandingAsset {
  src: `/images/${string}.webp`
  purpose: LandingAssetPurpose
  alt: string
}

function series(
  directory: string,
  count: number,
  purpose: LandingAssetPurpose,
  alt: (position: number) => string,
): readonly LandingAsset[] {
  return Array.from({ length: count }, (_, index) => ({
    src: `/images/${directory}/${index + 1}.webp` as const,
    purpose,
    alt: alt(index + 1),
  }))
}

export const SIGNAL_ASSETS = {
  RESEARCH: series(
    'signals/RESEARCH',
    4,
    'featured-signal',
    (n) => `AI research editorial image ${n}`,
  ),
  MODELS: series('signals/MODELS', 2, 'featured-signal', (n) => `AI models editorial image ${n}`),
  COMPANIES: series(
    'signals/COMPANIES',
    2,
    'featured-signal',
    (n) => `AI companies editorial image ${n}`,
  ),
  INFRASTRUCTURE: series(
    'signals/INFRASTRUCTURE',
    3,
    'featured-signal',
    (n) => `AI infrastructure editorial image ${n}`,
  ),
  OPEN_SOURCE: series(
    'signals/OPEN_SOURCE',
    3,
    'featured-signal',
    (n) => `Open-source AI editorial image ${n}`,
  ),
  FUNDING: series(
    'signals/FUNDING',
    3,
    'featured-signal',
    (n) => `AI funding editorial image ${n}`,
  ),
  REGULATION: series(
    'signals/REGULATION',
    4,
    'featured-signal',
    (n) => `AI regulation editorial image ${n}`,
  ),
  AGENTS: series('signals/AGENTS', 3, 'featured-signal', (n) => `AI agents editorial image ${n}`),
  HARDWARE: series(
    'signals/HARDWARE',
    4,
    'featured-signal',
    (n) => `AI hardware editorial image ${n}`,
  ),
} satisfies Record<SignalCategory, readonly LandingAsset[]>

export const FORECAST_ASSETS = series('forecasts', 3, 'forecast', (n) =>
  n === 1
    ? 'Researcher observing the horizon from a mountain observatory'
    : n === 2
      ? 'Analyst reviewing data above an automated factory floor'
      : 'Editorial image representing long-range AI forecasting',
)

export const OBSERVATION_ASSETS = series('observations', 4, 'observation', (n) =>
  n === 1
    ? 'Engineers observing autonomous drones in a field'
    : n === 2
      ? 'Researcher examining a semiconductor wafer in a laboratory'
      : `AI ecosystem observation image ${n}`,
)

export const HISTORY_ASSETS = series('history', 8, 'history', (n) => {
  const descriptions = [
    'Early computing researchers studying a chess position',
    'Researchers standing beside an early computing apparatus',
    'Early computing researchers reviewing a printed document',
    'Participants of the 1956 Dartmouth workshop gathered outside',
  ] as const
  return descriptions[n - 1] ?? `Early artificial intelligence history image ${n}`
})

export const LANDING_ASSETS: readonly LandingAsset[] = [
  ...Object.values(SIGNAL_ASSETS).flat(),
  ...FORECAST_ASSETS,
  ...OBSERVATION_ASSETS,
  ...HISTORY_ASSETS,
]

export function assetAt(assets: readonly LandingAsset[], index: number): LandingAsset {
  const asset = assets[index]
  if (!asset) throw new RangeError(`Landing asset index ${index} is unavailable`)
  return asset
}

const FEATURED_FALLBACKS = [
  assetAt(SIGNAL_ASSETS.RESEARCH, 0),
  assetAt(SIGNAL_ASSETS.MODELS, 0),
  assetAt(SIGNAL_ASSETS.COMPANIES, 0),
  assetAt(SIGNAL_ASSETS.INFRASTRUCTURE, 0),
  assetAt(SIGNAL_ASSETS.AGENTS, 0),
  assetAt(SIGNAL_ASSETS.HARDWARE, 0),
] as const

export function getFeaturedSignalAsset(
  category: SignalCategory | undefined,
  slotIndex: number,
): LandingAsset {
  if (!category) return assetAt(FEATURED_FALLBACKS, (slotIndex - 1) % FEATURED_FALLBACKS.length)
  const assets = SIGNAL_ASSETS[category]
  return assetAt(assets, (slotIndex - 1) % assets.length)
}
