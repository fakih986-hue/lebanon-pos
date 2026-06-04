import { execSync } from "child_process"
import { cpSync, existsSync } from "fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// In the packaged Electron app the bundled API runs under ELECTRON_RUN_AS_NODE.
// There, migrations are already applied by the Electron main process (raw-SQL
// runner) and there is no `npx`/Prisma CLI available — so skip CLI setup entirely.
if (process.env.ELECTRON_RUN_AS_NODE) {
  console.log("[setup] Packaged mode — migrations handled by host; skipping CLI setup.")
} else {
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
}
