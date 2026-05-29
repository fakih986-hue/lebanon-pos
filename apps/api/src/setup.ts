import { execSync } from "child_process"
import { cpSync, existsSync } from "fs"

console.log("[setup] started")

const ENV = { ...process.env, NO_COLOR: "1" }
const EXEC_OPTS = { stdio: "inherit" as const, env: ENV, timeout: 60_000 }

// Resolve the missing duplicate migration — its schema changes are identical
// to those in the surviving 20260526211605_variants_delivery migration.
try {
  execSync(`npx prisma migrate resolve --rolled-back "20260527000001_variants_delivery"`, EXEC_OPTS)
  console.log("[setup] rolled back missing migration: 20260527000001_variants_delivery")
} catch {
  // Already resolved or not in a failed state — safe to ignore
}

// Resolve the drift-fix migration that failed to apply because the schema
// changes (Driver enum, StaffUser.code, AppSettings delivery fields, etc.)
// were already present in the database from a prior `db push`.
try {
  execSync(`npx prisma migrate resolve --applied "20260528000001_fix_schema_drift"`, EXEC_OPTS)
  console.log("[setup] resolved failed migration: 20260528000001_fix_schema_drift")
} catch {
  // Already resolved or not in a failed state — safe to ignore
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
