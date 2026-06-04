/**
 * Generates apps/electron/assets/icon.png (256×256)
 * Pure Node.js — no external dependencies required.
 *
 * Usage:   node scripts/generate-icon.mjs
 * After:   Convert icon.png → icon.ico using ImageMagick:
 *            magick icon.png -define icon:auto-resize=256,128,64,48,32,16 icon.ico
 *          or online at https://convertio.co/png-ico/
 */

import { deflateSync } from "zlib"
import { writeFileSync, mkdirSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR   = join(__dirname, "../assets")

mkdirSync(OUT_DIR, { recursive: true })

// ── CRC-32 (needed for valid PNG chunks) ─────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii")
  const lenBuf  = Buffer.alloc(4)
  const crcBuf  = Buffer.alloc(4)
  lenBuf.writeUInt32BE(data.length, 0)
  const forCrc = Buffer.concat([typeBuf, data])
  crcBuf.writeUInt32BE(crc32(forCrc), 0)
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf])
}

// ── PNG builder ───────────────────────────────────────────────────────────────
function buildPNG(size, pixels) {
  const ihdrData = Buffer.alloc(13)
  ihdrData.writeUInt32BE(size, 0)   // width
  ihdrData.writeUInt32BE(size, 4)   // height
  ihdrData[8]  = 8   // bit depth
  ihdrData[9]  = 2   // RGB
  ihdrData[10] = 0   // compression method
  ihdrData[11] = 0   // filter method
  ihdrData[12] = 0   // interlace

  // Raw image data: one filter byte (0=None) + RGB per row
  const raw = Buffer.alloc(size * (1 + size * 3))
  for (let y = 0; y < size; y++) {
    raw[y * (1 + size * 3)] = 0 // filter=None
    for (let x = 0; x < size; x++) {
      const src = (y * size + x) * 3
      const dst = y * (1 + size * 3) + 1 + x * 3
      raw[dst]   = pixels[src]
      raw[dst+1] = pixels[src+1]
      raw[dst+2] = pixels[src+2]
    }
  }

  const PNG_SIG  = Buffer.from([137,80,78,71,13,10,26,10])
  const ihdrChunk = chunk("IHDR", ihdrData)
  const idatChunk = chunk("IDAT", deflateSync(raw))
  const iendChunk = chunk("IEND", Buffer.alloc(0))
  return Buffer.concat([PNG_SIG, ihdrChunk, idatChunk, iendChunk])
}

// ── Draw the icon ─────────────────────────────────────────────────────────────
// Lebanon POS logo: dark indigo background, rounded square, "L" letter
// Colors: bg=#1e1b4b (indigo-950), accent=#6366f1 (indigo-500), text=#f8fafc
const SIZE = 256
const pixels = new Uint8Array(SIZE * SIZE * 3)

const BG    = [30, 27, 75]   // indigo-950
const ACC   = [99, 102, 241] // indigo-500
const WHITE = [248, 250, 252]

// Fill background
for (let i = 0; i < SIZE * SIZE; i++) {
  pixels[i*3]   = BG[0]
  pixels[i*3+1] = BG[1]
  pixels[i*3+2] = BG[2]
}

function setPixel(x, y, r, g, b) {
  if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) return
  const i = (y * SIZE + x) * 3
  pixels[i] = r; pixels[i+1] = g; pixels[i+2] = b
}

function fillRect(x0, y0, x1, y1, col) {
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      setPixel(x, y, col[0], col[1], col[2])
}

function fillCircleCorner(cx, cy, r, col) {
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++)
      if (dx*dx + dy*dy <= r*r) setPixel(cx+dx, cy+dy, col[0], col[1], col[2])
}

// Rounded rectangle (accent card): inset 32px, corner radius 40
const P = 32, R = 40
fillRect(P+R, P, SIZE-P-R, SIZE-P, ACC)
fillRect(P, P+R, SIZE-P, SIZE-P-R, ACC)
fillCircleCorner(P+R, P+R, R, ACC)
fillCircleCorner(SIZE-P-R, P+R, R, ACC)
fillCircleCorner(P+R, SIZE-P-R, R, ACC)
fillCircleCorner(SIZE-P-R, SIZE-P-R, R, ACC)

// "L" letter — thick strokes
const LX = 86, LY = 72, LW = 28, LH = 120, SERIF = 68
fillRect(LX, LY, LX+LW, LY+LH, WHITE)           // vertical stroke
fillRect(LX, LY+LH-LW, LX+SERIF, LY+LH, WHITE)  // horizontal base

const png = buildPNG(SIZE, pixels)
writeFileSync(join(OUT_DIR, "icon.png"), png)
console.log(`✅  icon.png written (${SIZE}×${SIZE}, ${png.length} bytes)`)
console.log(`\nNext step — convert to ICO for Windows installer:`)
console.log(`  magick icon.png -define icon:auto-resize=256,128,64,48,32,16 icon.ico`)
console.log(`  (or upload to https://convertio.co/png-ico/)\n`)
