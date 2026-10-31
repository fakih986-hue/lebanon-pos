/**
 * Hub configuration that survives updates (apps/electron/src/hubConfig.ts, src/lib/dataDir.ts).
 *
 * An update runs the old version's uninstaller, which deletes the install directory. The cloud link
 * used to live there (<install dir>\data), so every update reopened activation; and the hub rewrote
 * BIND_HOST=127.0.0.1 into .env on every start, so LAN mode was lost on restart. The installer step
 * that stages the old folder (build/installer.nsh) is simulated here by a copy; the real installer is
 * covered by docs/HUB-INSTALL-CHECKLIST.md. Nothing here opens a network port.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { bindHostToKeep, migrateHubData, parseEnv, readCloudLink } from "../../electron/src/hubConfig"

const STORE_A = "tenant-store-a"
const STORE_B = "tenant-store-b"
let root: string
let userData: string, target: string, staging: string, installDir: string, legacy: string

const writeLink = (dir: string, tenantId: string, apiKey = `key-${tenantId}`) => {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, "cloud-config.json"), JSON.stringify({ tenantId, apiKey }))
}
const writeState = (dir: string, lastPullAt: string) => {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, "sync-state.json"), JSON.stringify({ lastPullAt, staffRefresh: 1 }))
}
const readState = (dir: string) => JSON.parse(fs.readFileSync(path.join(dir, "sync-state.json"), "utf-8"))
/** What build/installer.nsh does before the old uninstaller runs: copy <install>\data\*.json. */
const installerStages = () => {
  fs.mkdirSync(staging, { recursive: true })
  for (const f of fs.readdirSync(legacy).filter((n) => n.endsWith(".json"))) fs.copyFileSync(path.join(legacy, f), path.join(staging, f))
}
/** The old uninstaller on update: the install directory is gone. */
const oldUninstallerRuns = () => fs.rmSync(installDir, { recursive: true, force: true })
const migrate = (storeTenantIds: string[]) => migrateHubData({ target, sources: [staging, legacy], storeTenantIds, staging })

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "hub-config-"))
  userData = path.join(root, "AppData", "Roaming", "lebanon-pos")
  target = path.join(userData, "hub-data")
  staging = path.join(userData, "install-data-migration")
  installDir = path.join(root, "AppData", "Local", "Programs", "Titan POS")
  legacy = path.join(installDir, "data")
})
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
  delete process.env.TITAN_DATA_DIR
})

describe("cloud link adoption on upgrade", () => {
  it("1.0.51 -> new: the staged link and sync state are adopted for this store; no reactivation", () => {
    writeLink(legacy, STORE_A)
    writeState(legacy, "2026-10-31T10:00:00.000Z")
    installerStages()
    oldUninstallerRuns()
    expect(migrate([STORE_A])).toEqual({ action: "adopted", tenantId: STORE_A, source: staging })
    expect(readCloudLink(target)).toEqual({ tenantId: STORE_A, apiKey: `key-${STORE_A}` })
    expect(readState(target).lastPullAt).toBe("2026-10-31T10:00:00.000Z")
    // the cloud key is not left in a second place
    expect(fs.existsSync(staging)).toBe(false)
    // next start: kept, nothing re-adopted
    expect(migrate([STORE_A])).toEqual({ action: "kept", tenantId: STORE_A })
  })

  it("an install directory that survived (copy-over, portable) is adopted directly and left in place", () => {
    writeLink(legacy, STORE_A)
    expect(migrate([STORE_A])).toMatchObject({ action: "adopted", source: legacy })
    expect(readCloudLink(legacy)?.tenantId).toBe(STORE_A)
  })

  it("never overwrites a link already in user data, even with another store's link staged", () => {
    writeLink(target, STORE_B)
    writeState(target, "2026-11-01T08:00:00.000Z")
    writeLink(legacy, STORE_A)
    writeState(legacy, "2026-01-01T00:00:00.000Z")
    installerStages()
    expect(migrate([STORE_A, STORE_B])).toEqual({ action: "kept", tenantId: STORE_B })
    expect(readCloudLink(target)?.tenantId).toBe(STORE_B)
    expect(readState(target).lastPullAt).toBe("2026-11-01T08:00:00.000Z")
    // another store's staged link is left for an operator, not deleted
    expect(readCloudLink(staging)?.tenantId).toBe(STORE_A)
  })

  it("refuses a link for a store this hub's database does not hold; the hub opens activation", () => {
    writeLink(legacy, STORE_A)
    installerStages()
    oldUninstallerRuns()
    expect(migrate([STORE_B])).toEqual({ action: "refused", refused: [{ source: staging, tenantId: STORE_A }] })
    expect(readCloudLink(target)).toBeNull()
    expect(readCloudLink(staging)?.tenantId).toBe(STORE_A)
  })

  it("a database that holds no store yet accepts the link (the activation pull fills it)", () => {
    writeLink(legacy, STORE_A)
    expect(migrate([])).toMatchObject({ action: "adopted", tenantId: STORE_A })
  })

  it("an incomplete or unreadable link is not adopted; a corrupt user-data link is replaced by a valid one", () => {
    fs.mkdirSync(legacy, { recursive: true })
    fs.writeFileSync(path.join(legacy, "cloud-config.json"), JSON.stringify({ tenantId: STORE_A, apiKey: "" }))
    expect(migrate([STORE_A])).toEqual({ action: "none" })
    fs.mkdirSync(target, { recursive: true })
    fs.writeFileSync(path.join(target, "cloud-config.json"), "{ not json")
    writeLink(staging, STORE_A)
    expect(migrate([STORE_A])).toMatchObject({ action: "adopted", tenantId: STORE_A })
    expect(readCloudLink(target)?.tenantId).toBe(STORE_A)
  })

  it("does not overwrite sync state already in user data", () => {
    writeState(target, "2026-11-01T08:00:00.000Z")
    writeLink(legacy, STORE_A)
    writeState(legacy, "2026-01-01T00:00:00.000Z")
    migrate([STORE_A])
    expect(readState(target).lastPullAt).toBe("2026-11-01T08:00:00.000Z")
  })
})

describe("the API keeps its link in the persistent data folder", () => {
  it("reads and writes TITAN_DATA_DIR, across a restart and an upgrade", async () => {
    // upgrade: the old install's link reaches user data
    writeLink(legacy, STORE_A)
    installerStages()
    oldUninstallerRuns()
    migrate([STORE_A])

    // no cloud: the bridge must never start (dotenv does not override a variable that is set)
    process.env.CLOUD_API_URL = ""
    process.env.TITAN_DATA_DIR = target
    vi.resetModules()
    let sync = await import("../src/services/cloudSync")
    expect(sync.getCloudStatus()).toMatchObject({ tenantId: STORE_A, configured: false, running: false })

    // activation for this store writes there (the old install folder no longer exists)
    sync.saveCloudConfig(STORE_A, "rotated-key")
    sync.stopCloudSyncBridge()
    expect(readCloudLink(target)).toEqual({ tenantId: STORE_A, apiKey: "rotated-key" })
    expect(fs.existsSync(installDir)).toBe(false)

    // restart: a fresh process reads the same link
    vi.resetModules()
    sync = await import("../src/services/cloudSync")
    expect(sync.getCloudStatus().tenantId).toBe(STORE_A)
    sync.stopCloudSyncBridge()
  })
})

describe("LAN mode survives restart and upgrade", () => {
  it("a saved BIND_HOST=0.0.0.0 is kept; anything else is localhost only", () => {
    // .env lives in user data (kept on update); the hub rewrites it on every start
    const saved = parseEnv(`DATABASE_URL="postgresql://x"\nJWT_SECRET="s"\nBIND_HOST=0.0.0.0\nCORS_ORIGINS=\n`)
    expect(bindHostToKeep(saved.BIND_HOST)).toBe("0.0.0.0")
    expect(bindHostToKeep(parseEnv(`BIND_HOST="0.0.0.0"\r\n`).BIND_HOST)).toBe("0.0.0.0")
    expect(bindHostToKeep(parseEnv("BIND_HOST=127.0.0.1").BIND_HOST)).toBe("127.0.0.1")
    for (const other of [undefined, "", "192.168.1.5", "::", "0.0.0.0 ", "localhost"]) expect(bindHostToKeep(other)).toBe("127.0.0.1")
    expect(saved.JWT_SECRET).toBe("s")
  })
})
