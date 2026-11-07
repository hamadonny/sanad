import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
      // Spec §17: packages/core must keep >= 95% coverage.
      thresholds: { lines: 95, functions: 95, branches: 95, statements: 95 },
    },
  },
});
