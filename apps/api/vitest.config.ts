import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC is needed so Nest's decorator metadata (used for dependency injection) is emitted in tests.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
