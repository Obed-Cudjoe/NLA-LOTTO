import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The dashboard smoke test boots a real bundle in jsdom, which is slower on
    // shared CI runners than on a laptop. Generous timeouts keep it honest
    // (assertions still poll for real state) without being flaky.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    reporters: process.env.CI ? ['default'] : ['default'],
  },
});
