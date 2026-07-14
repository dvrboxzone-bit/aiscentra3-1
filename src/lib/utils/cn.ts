import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Merge Tailwind classes safely, resolving conflicts.
 * Standard pattern in every Next.js + Tailwind project.
 * Usage: cn('base-class', conditional && 'conditional-class', props.className)
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
