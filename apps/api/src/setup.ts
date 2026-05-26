import { execSync } from "child_process"
import { cpSync, existsSync } from "fs"

console.log("[setup] started")

try {
  console.log("[setup] Running prisma db push...")
  execSync("npx prisma db push --accept-data-loss", { stdio: "inherit", env: { ...process.env, NO_COLOR: "1" }, timeout: 60_000 })
  console.log("[setup] db push done, running seed...")
  execSync("npx tsx prisma/seed.ts", { stdio: "inherit", env: { ...process.env, NO_COLOR: "1" }, timeout: 60_000 })
  console.log("[setup] Database setup complete.")
} catch (err) {
  console.error("[setup] Database setup failed (continuing anyway):", err)
}

// Ensure Prisma client is generated (db push may skip generate if it fails early)
try {
  execSync("npx prisma generate", { stdio: "inherit", env: { ...process.env, NO_COLOR: "1" }, timeout: 30_000 })
} catch {
  console.error("[setup] prisma generate failed (will try copy from src/)")
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
