import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

// The admin app is served from a bundle committed in apps/api/public/admin (by the cloud and by every
// hub, which ships apps/api/public). It is built from apps/admin; nothing rebuilds it automatically.
// It was found stale: the review of held work existed in the source but in no bundle anyone could open.
// Every API path the admin source calls must be in the served bundle.
const root = path.resolve(__dirname, "..")
const adminSrc = path.resolve(root, "../admin/src")
const served = path.join(root, "public/admin")

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name)
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(name) ? [p] : []
  })
}

describe("the served admin bundle is built from the current admin source", () => {
  it("every API path the admin source calls is in the bundle (rebuild: vite build in apps/admin, copy dist to apps/api/public/admin)", () => {
    const paths = new Set<string>()
    for (const f of files(adminSrc)) for (const m of readFileSync(f, "utf8").matchAll(/["'`](\/api\/[A-Za-z0-9/_-]+)/g)) paths.add(m[1].replace(/\/$/, ""))
    expect(paths.size).toBeGreaterThan(5)
    const html = readFileSync(path.join(served, "index.html"), "utf8")
    const scripts = [...html.matchAll(/src="\/admin\/(assets\/[^"]+\.js)"/g)].map((m) => readFileSync(path.join(served, m[1]), "utf8")).join("\n")
    expect(scripts.length).toBeGreaterThan(0)
    const missing = [...paths].filter((p) => !scripts.includes(p))
    expect(missing).toEqual([])
    // the review of held work in particular
    expect(scripts).toContain("/api/sync/refused/decisions")
  })

  it("the served bundle was built from exactly the current admin source (rebuild: node scripts/bundle-to-api.mjs in apps/admin)", async () => {
    const { adminSourceHash } = await import(pathToFileURL(path.resolve(root, "../admin/scripts/source-hash.mjs")).href)
    const stamp = readFileSync(path.join(served, "source.sha256"), "utf8").trim()
    expect(stamp).toBe(adminSourceHash(path.resolve(root, "../admin")))
  })
})
