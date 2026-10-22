import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // PGlite boots a WASM Postgres instance; the first query in each worker can
    // take several seconds on a cold cache.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
})
