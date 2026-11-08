// @ts-check
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.expo/**',
      '**/coverage/**',
      '**/next-env.d.ts',
      'packages/api-client/src/schema.ts',
      'apps/api/migrations/**',
      'apps/mobile/android/**',
      'apps/mobile/ios/**',
      'apps/mobile/.maestro/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // Money must be integer fils. Ban parseFloat to make accidental float money harder.
      'no-restricted-globals': [
        'error',
        { name: 'parseFloat', message: 'Money is integer fils. Use the core money helpers.' },
      ],
    },
  },
  {
    // NestJS relies on classes with only decorators and constructor DI.
    files: ['apps/api/**/*.ts'],
    rules: {
      '@typescript-eslint/no-extraneous-class': 'off',
      '@typescript-eslint/consistent-type-imports': 'off',
      // Drizzle's `insert().returning()` yields arrays; `rows[0]!` after an insert is intended.
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    files: ['apps/mobile/**/*.tsx', 'apps/admin/**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: { 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'warn' },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
  {
    files: ['**/*.cjs', '**/*.config.js', '**/jest.setup.js'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  prettier,
);
