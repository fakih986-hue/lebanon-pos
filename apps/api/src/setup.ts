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

// Copy Prisma client from src/generated/ to dist/generated/ so ESM imports resolve
const src = "src/generated/prisma"
const dest = "dist/generated/prisma"
if (existsSync(src)) {
  cpSync(src, dest, { recursive: true })
  console.log("[setup] copied prisma client to dist/generated/prisma")
}

console.log("[setup] complete")
