import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { motifForCategory, extractKeyword, ILLUSTRATION_PALETTE } from '../illustration-style'
import type { SignalCategory } from '@/types/database'

describe('motifForCategory', () => {
  test('every category maps to a distinct, deterministic motif', () => {
    const categories: SignalCategory[] = [
      'RESEARCH',
      'MODELS',
      'COMPANIES',
      'INFRASTRUCTURE',
      'OPEN_SOURCE',
      'FUNDING',
      'REGULATION',
      'AGENTS',
      'HARDWARE',
    ]
    const motifs = categories.map(motifForCategory)
    assert.equal(new Set(motifs).size, categories.length, 'each category should have its own motif')
  })

  test('is deterministic — same category always gives same motif', () => {
    assert.equal(motifForCategory('MODELS'), motifForCategory('MODELS'))
  })
})

describe('extractKeyword', () => {
  test('picks the longest non-stopword, uppercased', () => {
    assert.equal(extractKeyword('The new transformer architecture'), 'ARCHITECTURE')
  })

  test('caps at 16 characters', () => {
    const long = extractKeyword('A extraordinarily-long-hyphenated-word-here appears')
    assert.ok(long.length <= 16)
  })

  test('falls back to SIGNAL when only stopwords remain', () => {
    assert.equal(extractKeyword('the a an and'), 'SIGNAL')
  })

  test('falls back to SIGNAL for an empty title', () => {
    assert.equal(extractKeyword(''), 'SIGNAL')
  })

  test('strips punctuation before selecting a word', () => {
    const result = extractKeyword('GPT-5: A New Benchmark!')
    assert.equal(/[^A-Z0-9-]/.test(result), false)
  })
})

describe('ILLUSTRATION_PALETTE', () => {
  test('contains only the Design Foundation v1.0 grayscale hex values', () => {
    for (const value of Object.values(ILLUSTRATION_PALETTE)) {
      assert.match(value, /^#[0-9A-Fa-f]{6}$/)
    }
  })
})
