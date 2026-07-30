import { dirname } from 'path'
import { fileURLToPath } from 'url'
import { FlatCompat } from '@eslint/eslintrc'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const compat = new FlatCompat({ baseDirectory: __dirname })

const config = [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    // Type-aware rules require parserOptions.project. tsconfig.eslint.json
    // extends the app's tsconfig.json but additionally includes
    // supabase/functions/**/*.ts (excluded from tsconfig.json's own
    // `include`/`exclude` for the Next.js build target, but still a real
    // part of this repository that must be linted, not blanket-ignored).
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.eslint.json',
        tsconfigRootDir: __dirname,
      },
    },
    rules: {
      // Enforce explicit return types on functions — clarity in a complex codebase
      '@typescript-eslint/explicit-function-return-type': [
        'error',
        {
          allowExpressions: true,
          allowTypedFunctionExpressions: true,
        },
      ],
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
    // Global ignores. Only build output, dependencies, and this config file
    // itself (a .mjs config file, not part of any tsconfig program) are
    // excluded — supabase/functions is NOT blanket-ignored.
    ignores: ['.next/', 'node_modules/', 'dist/', 'eslint.config.mjs'],
  },
]

export default config
