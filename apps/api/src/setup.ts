import { execSync } from "child_process"
import { cpSync, existsSync } from "fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

console.log("[setup] Database setup …")

const ENV = { ...process.env, NO_COLOR: "1" }
const EXEC_OPTS = { stdio: "inherit" as const, env: ENV, timeout: 60_000 }

try {
  execSync("npx prisma migrate deploy", EXEC_OPTS)
} catch (err) {
  console.error("[setup] Migration failed:", err)
  process.exit(1)
}

// Copy Prisma client to dist so ESM imports resolve at runtime
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const srcDir = path.resolve(__dirname, "../src/generated/prisma")
const destDir = path.resolve(__dirname, "../dist/generated/prisma")
if (existsSync(srcDir)) {
  cpSync(srcDir, destDir, { recursive: true })
}

console.log("[setup] Ready")
