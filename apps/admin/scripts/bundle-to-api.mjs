// Builds the admin app and installs it where the cloud and every hub serve it (apps/api/public/admin),
// with a stamp of the source it was built from (source.sha256). apps/api/__tests__/admin-bundle.test.ts
// fails when the admin source and the served bundle's stamp differ.
//   node scripts/bundle-to-api.mjs        (cwd: apps/admin)
import { execFileSync } from "node:child_process"
import { cpSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { adminSourceHash } from "./source-hash.mjs"

const admin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const served = path.resolve(admin, "../api/public/admin")
execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", ["vite", "build"], { cwd: admin, stdio: "inherit", shell: process.platform === "win32" })
rmSync(path.join(served, "assets"), { recursive: true, force: true })
mkdirSync(served, { recursive: true })
cpSync(path.join(admin, "dist"), served, { recursive: true })
writeFileSync(path.join(served, "source.sha256"), adminSourceHash(admin) + "\n")
console.log("admin bundle installed at", served)
