// The hash of what the admin bundle is built from: src/, index.html, vite.config.ts and package.json, with
// line endings normalized (a checkout's CRLF conversion does not change it).
import { createHash } from "node:crypto"
import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"

function files(dir) {
  return readdirSync(dir).sort().flatMap((name) => {
    const p = path.join(dir, name)
    return statSync(p).isDirectory() ? files(p) : [p]
  })
}

export function adminSourceHash(adminDir) {
  const h = createHash("sha256")
  const list = [...files(path.join(adminDir, "src")), ...["index.html", "vite.config.ts", "package.json"].map((f) => path.join(adminDir, f))]
  for (const f of list) {
    h.update(path.relative(adminDir, f).replace(/\\/g, "/"))
    h.update("\0")
    h.update(readFileSync(f, "utf8").replace(/\r\n/g, "\n"))
    h.update("\0")
  }
  return h.digest("hex")
}
