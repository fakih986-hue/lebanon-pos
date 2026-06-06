/**
 * Copy the freshly-built desktop POS SPA into the API's public folder.
 *
 * Electron loads the UI from the bundled API server (http://localhost:3001),
 * which serves static files from apps/api/public/. The desktop POS is the ROOT
 * SPA (index.html + /assets), while admin/driver/order/owner live in subfolders.
 *
 * Without this step the API serves a stale POS build and the app looks outdated.
 */
import { cpSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const src = join(__dirname, "..", "..", "apps", "desktop", "dist")
const dst = join(__dirname, "..", "..", "apps", "api", "public")

if (!existsSync(src)) {
  console.error("✗ desktop/dist not found — run the desktop build first.")
  process.exit(1)
}

// Merge-copy: overwrites index.html + adds hashed /assets, keeps admin/driver/order subfolders
cpSync(src, dst, { recursive: true })
console.log("📋 Copied desktop POS SPA → apps/api/public")
