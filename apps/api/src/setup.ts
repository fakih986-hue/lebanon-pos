import { execSync } from "child_process"
import { cpSync, existsSync } from "fs"

console.log("[setup] started")

try {
  console.log("[setup] Running prisma migrate deploy...")
  execSync("npx prisma migrate deploy", { stdio: "inherit", env: { ...process.env, NO_COLOR: "1" }, timeout: 60_000 })
  console.log("[setup] Migrations applied.")
} catch (err) {
  console.error("[setup] prisma migrate deploy failed:", err)
  // Do not continue — a failed migration means the schema is out of sync
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
