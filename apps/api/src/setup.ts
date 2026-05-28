import { execSync } from "child_process"
import { cpSync, existsSync } from "fs"

console.log("[setup] started")

const ENV = { ...process.env, NO_COLOR: "1" }
const EXEC_OPTS = { stdio: "inherit" as const, env: ENV, timeout: 60_000 }

// If a previous deploy used `db push`, types/tables were created directly in the DB
// without migration tracking. Those migrations would then fail with "already exists".
// Resolve them as "applied" so Prisma stops blocking on them.
const PRE_APPLIED_MIGRATIONS = [
  "20260526211605_variants_delivery",
  "20260527000001_variants_delivery",
]
for (const name of PRE_APPLIED_MIGRATIONS) {
  try {
    execSync(`npx prisma migrate resolve --applied ${name}`, EXEC_OPTS)
    console.log(`[setup] resolved migration: ${name}`)
  } catch {
    // Already resolved or not in a failed state — safe to ignore
  }
}

try {
  console.log("[setup] Running prisma migrate deploy...")
  execSync("npx prisma migrate deploy", EXEC_OPTS)
  console.log("[setup] Migrations applied.")
} catch (err) {
  console.error("[setup] prisma migrate deploy failed:", err)
  process.exit(1)
}

// Copy Prisma client from src/generated/ to dist/generated/ so ESM imports resolve
const srcDir = "src/generated/prisma"
const destDir = "dist/generated/prisma"
if (existsSync(srcDir)) {
  cpSync(srcDir, destDir, { recursive: true })
  console.log("[setup] copied prisma client to dist/generated/prisma")
} else {
  console.error("[setup] prisma client not found at", srcDir)
}

console.log("[setup] complete")
