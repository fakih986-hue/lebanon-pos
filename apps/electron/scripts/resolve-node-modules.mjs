import { cp, mkdir, readdir } from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(DIR, '../../api/node_modules')
const DEST = path.resolve(DIR, '../dist/api-node-modules')

const SKIP = new Set([
  '.bin', '.cache', '.ignored', '.vite', '.package-lock.json',
  '@types', 'vitest', 'esbuild', 'tsx', 'typescript', '@vercel',
])

async function main() {
  console.log(`[resolve] ${SRC} → ${DEST}`)
  await mkdir(DEST, { recursive: true })
  const entries = await readdir(SRC, { withFileTypes: true })
  for (const entry of entries) {
    if (SKIP.has(entry.name)) continue
    try {
      await cp(path.join(SRC, entry.name), path.join(DEST, entry.name), { recursive: true, dereference: true })
      console.log(`  ✓ ${entry.name}`)
    } catch (err) {
      console.error(`  ✗ ${entry.name}: ${err.message}`)
    }
  }
  console.log('[resolve] done')
}

main().catch(console.error)
