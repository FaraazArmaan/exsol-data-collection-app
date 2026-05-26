import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: true,
    testTimeout: 20_000,
    hookTimeout: 30_000,
    setupFiles: ['tests/setup-env.ts'],
  },
});
