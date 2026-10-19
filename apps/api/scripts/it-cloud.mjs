// Starts a LOCAL integration-test cloud (this API in cloud mode) against an allowlisted scratch
// database. Fail-closed: it refuses production hosts and cloud credentials, never reads apps/api/.env,
// and never starts the cloud sync bridge. Normal startup (src/index.ts, the Electron hub) is unchanged.
//
//   DATABASE_URL=<scratch db url> JWT_SECRET=<test secret> node scripts/it-cloud.mjs [--port 3998]
import { spawn } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { itCloudRefusals } from "./it-guard.mjs"

const here = path.dirname(fileURLToPath(import.meta.url))
const portArg = process.argv.indexOf("--port")
const port = portArg > 0 ? Number(process.argv[portArg + 1]) : 3998
if (!Number.isInteger(port) || port < 1024) { console.error("[it-cloud] refused: bad --port"); process.exit(2) }

// No dotenv file: an empty one, so the API's `dotenv/config` cannot load apps/api/.env (which on a
// developer machine points the sync bridge at production).
const emptyEnv = path.join(mkdtempSync(path.join(tmpdir(), "it-cloud-")), "empty.env")
writeFileSync(emptyEnv, "")
const env = { ...process.env, DOTENV_CONFIG_PATH: emptyEnv, IS_LOCAL_SERVER: "false", PORT: String(port), BIND_HOST: "127.0.0.1", NODE_ENV: process.env.NODE_ENV ?? "production" }
if (!env.JWT_SECRET) { console.error("[it-cloud] refused: set JWT_SECRET to a test secret"); process.exit(2) }

const refusals = itCloudRefusals(env)
if (refusals.length) {
  console.error("[it-cloud] refused to start:")
  for (const r of refusals) console.error(`  - ${r}`)
  process.exit(2)
}

console.log(`[it-cloud] local test cloud on 127.0.0.1:${port}, scratch database, no sync bridge`)
const child = spawn("npx", ["tsx", "src/index.ts"], { cwd: path.resolve(here, ".."), env, stdio: "inherit", shell: process.platform === "win32" })
child.on("exit", (code) => process.exit(code ?? 1))
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig))
