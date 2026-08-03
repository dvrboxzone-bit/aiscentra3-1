/**
 * AIscentra — Signal Illustration Style
 *
 * Pure, deterministic mapping from a signal's category (and title) to
 * an abstract visual motif. Decoupled from rendering (next/og's
 * ImageResponse, in the sibling opengraph-image.tsx route) so the
 * mapping itself is unit-testable without invoking Satori/edge runtime.
 *
 * Design constraint: strictly monochrome, matching Design Foundation
 * v1.0 (tailwind.config.ts) -- illustrations are never decoration with
 * their own color language; they use the exact same palette as the
 * rest of the Observatory (observatory-black/dark/surface/border,
 * text-primary/secondary/muted, signal-critical/high/medium/low).
 */
import type { SignalCategory } from '@/types/database'

export type IllustrationMotif =
  | 'CONCENTRIC_RINGS'
  | 'LAYERED_BARS'
  | 'OVERLAPPING_SQUARES'
  | 'LATTICE_GRID'
  | 'BRANCHING_LINES'
  | 'ASCENDING_BARS'
  | 'PARALLEL_LINES'
  | 'CONNECTED_NODES'
  | 'ANGULAR_BLOCKS'

const CATEGORY_MOTIF: Record<SignalCategory, IllustrationMotif> = {
  RESEARCH: 'CONCENTRIC_RINGS',
  MODELS: 'LAYERED_BARS',
  COMPANIES: 'OVERLAPPING_SQUARES',
  INFRASTRUCTURE: 'LATTICE_GRID',
  OPEN_SOURCE: 'BRANCHING_LINES',
  FUNDING: 'ASCENDING_BARS',
  REGULATION: 'PARALLEL_LINES',
  AGENTS: 'CONNECTED_NODES',
  HARDWARE: 'ANGULAR_BLOCKS',
}

/** Strictly the Design Foundation v1.0 grayscale palette -- no other colors. */
export const ILLUSTRATION_PALETTE = {
  black: '#0A0A0A',
  dark: '#111111',
  surface: '#171717',
  border: '#242424',
  textPrimary: '#FFFFFF',
  textSecondary: '#B5B5B5',
  textMuted: '#7A7A7A',
  signalHigh: '#D4D4D4',
  signalMedium: '#8A8A8A',
  signalLow: '#4A4A4A',
} as const

export function motifForCategory(category: SignalCategory): IllustrationMotif {
  return CATEGORY_MOTIF[category] ?? 'CONCENTRIC_RINGS'
}

/**
 * Extracts a single, short keyword from a signal title for the
 * illustration overlay -- the longest word (ties broken by first
 * occurrence) that isn't a common stopword, capped at 16 characters so
 * it never overflows the fixed 1200x630 canvas regardless of the
 * source title's length.
 */
const STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'but',
  'for',
  'with',
  'from',
  'into',
  'this',
  'that',
  'new',
  'how',
  'why',
  'what',
  'when',
  'its',
  'it',
  'is',
  'are',
  'to',
  'of',
  'in',
  'on',
  'at',
  'by',
  'as',
])

export function extractKeyword(title: string): string {
  const words = title
    .replace(/[^\w\s-]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 0 && !STOPWORDS.has(w.toLowerCase()))

  if (words.length === 0) return 'SIGNAL'

  let longest = words[0] ?? 'SIGNAL'
  for (const w of words) {
    if (w.length > longest.length) longest = w
  }

  return longest.slice(0, 16).toUpperCase()
}
