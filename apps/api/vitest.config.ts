import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globalSetup: [],
    setupFiles: ['test/setup.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
})
