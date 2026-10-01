import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // The end-to-end WebSocket tests bind real ports. Give them room and run the
    // files in a single fork so the two 2-player games cannot contend.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    pool: 'forks',
  },
});
