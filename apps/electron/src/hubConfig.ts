// Hub configuration that must outlive the install directory. No Electron imports: unit-tested from
// apps/api/__tests__/hub-config.test.ts.
//
// Up to 1.0.52 the hub's API kept its cloud link (cloud-config.json: tenant id + store cloud key) and
// sync state in <install dir>\data. An update runs the old version's uninstaller, which deletes the
// install directory, so every update dropped the cloud link and reopened activation. The API now
// keeps them in the user-data folder (TITAN_DATA_DIR = <userData>\hub-data); the installer stages
// the old folder before the old uninstaller runs (build/installer.nsh) and the hub adopts it here.

import fs   from "node:fs"
import path from "node:path"

export const CLOUD_CONFIG_FILE = "cloud-config.json"
export const SYNC_STATE_FILE   = "sync-state.json"

export interface CloudLink { tenantId: string; apiKey: string }

export type HubDataMigration =
  | { action: "kept"; tenantId: string }
  | { action: "adopted"; tenantId: string; source: string }
  | { action: "none" }
  | { action: "refused"; refused: { source: string; tenantId: string }[] }

/** The cloud link in a data folder, or null when it is missing, unreadable or incomplete. */
export function readCloudLink(dir: string): CloudLink | null {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(dir, CLOUD_CONFIG_FILE), "utf-8")) as Partial<CloudLink>
    const tenantId = typeof cfg.tenantId === "string" ? cfg.tenantId.trim() : ""
    const apiKey   = typeof cfg.apiKey === "string" ? cfg.apiKey.trim() : ""
    return tenantId && apiKey ? { tenantId, apiKey } : null
  } catch {
    return null
  }
}

/** Write a file so a crash never leaves it half-written (temp file, then rename). */
function writeAtomic(file: string, text: string): void {
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, text, { mode: 0o600 })
  fs.renameSync(tmp, file)
}

/**
 * Adopt an older install's cloud link into `target`, the hub's persistent data folder.
 *
 * - A valid link already in `target` is never overwritten (it may be another store's binding).
 * - A source link is adopted only if its store is one this hub's database holds; a database that
 *   holds no store yet accepts it. Anything else is refused and left where it is, and the hub opens
 *   activation as before.
 * - Sync state is copied with the link it belongs to, only when `target` has none.
 * - The installer's staging copy is removed once adopted, so the cloud key is not left in two places.
 */
export function migrateHubData(opts: { target: string; sources: string[]; storeTenantIds: string[]; staging?: string }): HubDataMigration {
  fs.mkdirSync(opts.target, { recursive: true, mode: 0o700 })
  const current = readCloudLink(opts.target)
  if (current) {
    if (opts.staging && readCloudLink(opts.staging)?.tenantId === current.tenantId) fs.rmSync(opts.staging, { recursive: true, force: true })
    return { action: "kept", tenantId: current.tenantId }
  }
  const refused: { source: string; tenantId: string }[] = []
  for (const source of opts.sources) {
    if (path.resolve(source) === path.resolve(opts.target)) continue
    const link = readCloudLink(source)
    if (!link) continue
    if (opts.storeTenantIds.length > 0 && !opts.storeTenantIds.includes(link.tenantId)) {
      refused.push({ source, tenantId: link.tenantId })
      continue
    }
    const state = path.join(source, SYNC_STATE_FILE)
    if (fs.existsSync(state) && !fs.existsSync(path.join(opts.target, SYNC_STATE_FILE))) {
      writeAtomic(path.join(opts.target, SYNC_STATE_FILE), fs.readFileSync(state, "utf-8"))
    }
    writeAtomic(path.join(opts.target, CLOUD_CONFIG_FILE), JSON.stringify(link, null, 2))
    if (opts.staging && path.resolve(source) === path.resolve(opts.staging)) fs.rmSync(opts.staging, { recursive: true, force: true })
    return { action: "adopted", tenantId: link.tenantId, source }
  }
  return refused.length > 0 ? { action: "refused", refused } : { action: "none" }
}

/** LAN mode is a saved choice: keep "0.0.0.0" when it was set; anything else means localhost only. */
export function bindHostToKeep(saved: string | undefined): "0.0.0.0" | "127.0.0.1" {
  return saved === "0.0.0.0" ? "0.0.0.0" : "127.0.0.1"
}

/** The values of an existing .env file (quotes removed). */
export function parseEnv(text: string): Record<string, string> {
  const values: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (match) values[match[1]] = match[2].replace(/^"|"$/g, "")
  }
  return values
}
