import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'src/**/__tests__/**/*.test.js',
      'packages/**/__tests__/**/*.test.js',
    ],
    environment: 'node',
    clearMocks: true,
    testTimeout: 10000,
  },
});
