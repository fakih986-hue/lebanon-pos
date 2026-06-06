/**
 * Generate the Titan app icons from a single source image.
 *
 * 1. Save your Titan logo as a square PNG here:
 *        apps/electron/assets/titan-source.png
 *    (1024×1024 ideal, transparent or black background)
 *
 * 2. Install the two helpers once (from apps/electron):
 *        pnpm add -D sharp png-to-ico
 *
 * 3. Run it:
 *        node make-icons.mjs
 *
 * Produces:  assets/icon.png  (1024²)  and  assets/icon.ico  (multi-size)
 * Also copies a 512² PNG to the desktop web app:  apps/desktop/public/titan-logo.png
 */
import { fileURLToPath } from "node:url"
import path from "node:path"
import fs from "node:fs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.join(__dirname, "assets", "titan-source.png")

if (!fs.existsSync(SRC)) {
  console.error("\n✗ Source not found:", SRC)
  console.error("  Save your Titan logo as a square PNG at that path, then re-run.\n")
  process.exit(1)
}

const sharp = (await import("sharp")).default
const pngToIco = (await import("png-to-ico")).default

const assets = path.join(__dirname, "assets")
const publicDir = path.join(__dirname, "..", "desktop", "public")

// 1024² master PNG (Windows large icon + macOS)
await sharp(SRC).resize(1024, 1024, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 1 } })
  .png().toFile(path.join(assets, "icon.png"))
console.log("✓ assets/icon.png (1024²)")

// Multi-resolution .ico for Windows installer + window/taskbar
const sizes = [16, 24, 32, 48, 64, 128, 256]
const pngBuffers = await Promise.all(
  sizes.map((s) =>
    sharp(SRC).resize(s, s, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 1 } }).png().toBuffer()
  )
)
const icoBuffer = await pngToIco(pngBuffers)
fs.writeFileSync(path.join(assets, "icon.ico"), icoBuffer)
console.log("✓ assets/icon.ico (" + sizes.join(", ") + ")")

// Web app logo used by the in-app TitanLogo component
if (fs.existsSync(publicDir)) {
  await sharp(SRC).resize(512, 512, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 1 } })
    .png().toFile(path.join(publicDir, "titan-logo.png"))
  console.log("✓ apps/desktop/public/titan-logo.png (512²)")
}

console.log("\nDone. Rebuild the installer with:  pnpm run package\n")
