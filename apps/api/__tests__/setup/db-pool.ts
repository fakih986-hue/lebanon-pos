// Real-database tests: each test file opens its own Prisma clients (some open two: a hub and a
// cloud), and Prisma's default pool grows with the CPU count. With many files in parallel the
// local Postgres (max_connections 100) ran out of connections and real failures were hidden among
// "too many clients" errors. Every client in a test run gets a small pool; with maxWorkers in
// vitest.config.ts this bounds the total. An explicit connection_limit in DATABASE_URL wins.
const url = process.env.DATABASE_URL
if (url && !/[?&]connection_limit=/.test(url)) {
  process.env.DATABASE_URL = `${url}${url.includes("?") ? "&" : "?"}connection_limit=4`
}
