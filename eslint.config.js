import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import solid from 'eslint-plugin-solid/configs/typescript';
import * as tsParser from '@typescript-eslint/parser';
import eslintConfigPrettier from 'eslint-config-prettier/flat';

export default [
  // Ignore build output
  {
    ignores: [
      'dist/**',
      'dist-electron/**',
      'dist-remote/**',
      'release/**',
      'node_modules/**',
      '.worktrees/**',
      '.claude/**',
      // ultrakod-listener is a standalone package (own tsconfig, own build
      // output) — its dist/ isn't caught by the root-anchored 'dist/**' above.
      'ultrakod-listener/dist/**',
      // Build config is excluded from electron tsconfig; ignore the config and its test.
      'electron/vite.config.electron.ts',
      'electron/vite.config.electron.test.ts',
    ],
  },

  // Base JS recommended rules
  js.configs.recommended,

  // TypeScript strict rules (non-type-checked to avoid perf cost in CI)
  ...tseslint.configs.strict,

  // SolidJS-specific rules for TSX files
  {
    files: ['src/**/*.{ts,tsx}'],
    ...solid,
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: './tsconfig.json',
      },
    },
  },

  // Electron backend files use Node tsconfig
  {
    files: ['electron/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: './electron/tsconfig.json',
      },
    },
  },

  // Custom strict rules
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      // Prevent `any` — use `unknown` instead
      '@typescript-eslint/no-explicit-any': 'error',

      // Require explicit return types on exported functions
      '@typescript-eslint/explicit-module-boundary-types': 'off',

      // No unused variables (underscore prefix allowed for intentional skips)
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      // Consistency
      'prefer-const': 'error',
      'no-var': 'error',
      eqeqeq: ['error', 'always'],
      curly: ['error', 'multi-line'],

      // No console.log (allow warn/error for legitimate error reporting)
      'no-console': ['warn', { allow: ['warn', 'error'] }],

      // Prevent non-null assertions (prefer explicit checks)
      '@typescript-eslint/no-non-null-assertion': 'warn',
    },
  },

  // SolidJS store files use `produce()` which provides a mutable draft where
  // `delete` on dynamic keys is the intended API for removing store entries.
  {
    files: ['src/store/**/*.ts'],
    rules: {
      '@typescript-eslint/no-dynamic-delete': 'off',
    },
  },

  // CJS files (electron/preload.cjs): allow require(), CommonJS globals
  {
    files: ['**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        require: 'readonly',
        module: 'readonly',
        exports: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        process: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },

  // CLI files: allow console.log for user-facing output
  {
    files: ['electron/ultrakod/cli.ts'],
    rules: {
      'no-console': 'off',
    },
  },

  // Plain Node build scripts (.mjs): not TypeScript, so no-undef needs actual
  // Node globals configured rather than relying on typescript-eslint to
  // disable it, and console.log IS these scripts' progress output. Scoped to
  // ultrakod-listener specifically — the repo's other scripts/*.mjs files
  // already declare their own globals via inline `/* global ... */` comments.
  {
    files: ['ultrakod-listener/scripts/**/*.mjs'],
    languageOptions: {
      sourceType: 'module',
      globals: {
        process: 'readonly',
        console: 'readonly',
      },
    },
    rules: {
      'no-console': 'off',
    },
  },

  // ultrakod-listener is a standalone service — console.log IS its status
  // logging (viewed via the host's log viewer), not debug output to clean up.
  {
    files: ['ultrakod-listener/src/index.ts'],
    rules: {
      'no-console': 'off',
    },
  },

  // Disable rules that conflict with Prettier (must be last)
  eslintConfigPrettier,
];
