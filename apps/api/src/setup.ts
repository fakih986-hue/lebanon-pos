import { execSync } from "child_process"
import { cpSync, existsSync } from "fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

console.log("[setup] started")

const ENV = { ...process.env, NO_COLOR: "1" }
const QUIET = { stdio: ["inherit", "inherit", "ignore"] as [any, any, any], env: ENV, timeout: 60_000 }

const EXEC_OPTS = { stdio: "inherit" as const, env: ENV, timeout: 60_000 }

// Resolve the missing duplicate migration — its schema changes are identical
// to those in the surviving 20260526211605_variants_delivery migration.
try {
  execSync(`npx prisma migrate resolve --rolled-back "20260527000001_variants_delivery"`, QUIET)
} catch {
  // Already resolved or not in a failed state — safe to ignore
}

// Resolve the drift-fix migration that failed to apply because the schema
// changes were already present in the database from a prior `db push`.
try {
  execSync(`npx prisma migrate resolve --applied "20260528000001_fix_schema_drift"`, QUIET)
} catch {
  // Already resolved or not in a failed state — safe to ignore
}

// Resolve the Phase-0 migration that failed because duplicate empty StaffUser.mobile
// values violated the new unique constraint.
try {
  execSync(`npx prisma migrate resolve --rolled-back "20260604000001_phase0_po_items_staff_unique"`, QUIET)
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
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const srcDir = path.resolve(__dirname, "../src/generated/prisma")
const destDir = path.resolve(__dirname, "../dist/generated/prisma")
if (existsSync(srcDir)) {
  cpSync(srcDir, destDir, { recursive: true })
  console.log("[setup] prisma client ready")
} else {
  console.error("[setup] prisma client not found at", srcDir)
}

console.log("[setup] complete")
