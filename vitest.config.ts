import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    // Keep in sync with tsconfig.json "paths" and vite.config.ts — vitest does
    // not read tsconfig path aliases on its own.
    alias: {
      '@registry': path.resolve(__dirname, 'src/modules/registry'),
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx', 'src/**/*.test.ts', 'src/**/*.test.tsx', 'netlify/**/*.test.ts'],
    globals: true,
    testTimeout: 20_000,
    hookTimeout: 30_000,
    setupFiles: ['tests/setup-env.ts'],
  },
});
