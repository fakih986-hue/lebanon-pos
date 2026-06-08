import { cpSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, "..")

// Copy desktop SPA to API public
cpSync(
  join(ROOT, "apps/desktop/dist"),
  join(ROOT, "apps/api/public"),
  { recursive: true }
)

// Copy admin SPA to API public/admin
cpSync(
  join(ROOT, "apps/admin/dist"),
  join(ROOT, "apps/api/public/admin"),
  { recursive: true }
)

console.log("📋 SPAs copied to API public/")
