/**
 * Bundles the Lebanon POS API into a single CJS file for Electron packaging.
 *
 * Output: apps/api/bundle/
 *   index.cjs              ← entire API in one file (no node_modules needed)
 *   generated/prisma/      ← Prisma client + native .node binary
 *   public/                ← static SPA assets served by Express
 *   prisma/                ← schema.prisma + migrations (for migrate deploy)
 *   .env.example           ← reference for setup wizard
 *
 * Usage: node scripts/bundle.mjs
 */

import { build }      from "esbuild"
import { cpSync, mkdirSync, rmSync, existsSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT      = join(__dirname, "..")
const OUT       = join(ROOT, "bundle")

// Clean previous build
if (existsSync(OUT)) rmSync(OUT, { recursive: true })
mkdirSync(OUT, { recursive: true })

console.log("📦 Bundling API with esbuild…")

await build({
  entryPoints: [join(ROOT, "src/index.ts")],
  bundle:      true,
  platform:    "node",
  target:      "node20",
  format:      "cjs",          // CJS so __dirname works in packaged Electron
  outfile:     join(OUT, "index.cjs"),
  sourcemap:   false,
  minify:      false,          // keep readable for debugging
  external: [
    // Prisma native binary — must stay as a separate .node file
    "@prisma/client",
    // Node built-ins (already available in Electron's Node.js)
    "node:*",
  ],
  // Inject __dirname and __filename for ESM→CJS compatibility
  define: {
    "import.meta.url": "__importMetaUrl",
  },
  banner: {
    js: [
      `const __importMetaUrl = require('url').pathToFileURL(__filename).href;`,
    ].join("\n"),
  },
})

console.log("✅  Bundle written → bundle/index.cjs")

// Copy Prisma generated client (includes native .node binary)
console.log("📋 Copying Prisma client…")
cpSync(
  join(ROOT, "src/generated/prisma"),
  join(OUT, "generated/prisma"),
  { recursive: true }
)

// Copy static SPA assets
console.log("📋 Copying public assets…")
cpSync(join(ROOT, "public"), join(OUT, "public"), { recursive: true })

// Copy prisma schema + migrations (needed for migrate deploy on first run)
console.log("📋 Copying Prisma schema & migrations…")
cpSync(join(ROOT, "prisma"), join(OUT, "prisma"), { recursive: true })

console.log(`\n✅  API bundle ready in apps/api/bundle/`)
console.log(`   Size: ${(await import("fs")).statSync(join(OUT, "index.cjs")).size.toLocaleString()} bytes\n`)
