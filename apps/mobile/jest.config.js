/** Component tests (React Native Testing Library on jest-expo). Plain-TS tests run on Vitest. */
module.exports = {
  preset: 'jest-expo',
  testMatch: ['<rootDir>/src/**/*.test.tsx'],
  modulePathIgnorePatterns: ['<rootDir>/dist'],
  // Screens keep timers (countdowns, polling); exit once all tests finish.
  forceExit: true,
  testTimeout: 30000,
  setupFiles: ['<rootDir>/jest.setup.js'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sanad/.*|@noble/.*|i18next|react-i18next|zustand|@tanstack/.*))',
  ],
};
