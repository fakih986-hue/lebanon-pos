import { defineConfig } from "vitest/config"

// Bounded concurrency for the database-heavy suite (see __tests__/setup/db-pool.ts): at most 3 test
// files at once, each Prisma client limited to 4 connections, well under the local server's 100.
export default defineConfig({
  test: {
    maxWorkers: 3,
    setupFiles: ["./__tests__/setup/db-pool.ts"],
  },
})
