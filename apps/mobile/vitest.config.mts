import { defineConfig } from 'vitest/config';

// Plain-TS unit tests only. Component tests (React Native Testing Library + jest-expo)
// and E2E (Maestro) arrive in Phase 3.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
