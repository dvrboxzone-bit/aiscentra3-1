import { dirname } from 'path'
import { fileURLToPath } from 'url'
import { FlatCompat } from '@eslint/eslintrc'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const compat = new FlatCompat({ baseDirectory: __dirname })

const config = [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      // Enforce explicit return types on functions — clarity in a complex codebase
      '@typescript-eslint/explicit-function-return-type': ['error', {
        allowExpressions: true,
        allowTypedFunctionExpressions: true,
      }],
      // No any — the Observatory codebase must be fully typed
      '@typescript-eslint/no-explicit-any': 'error',
      // Consistent imports
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      // No unused vars — clean codebase
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // Prefer nullish coalescing over ||
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      // No non-null assertions — handle null explicitly
      '@typescript-eslint/no-non-null-assertion': 'error',
    },
  },
  {
    ignores: ['.next/', 'node_modules/', 'dist/'],
  },
]

export default config
