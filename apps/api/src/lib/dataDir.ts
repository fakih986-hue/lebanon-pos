import path from "node:path"
import { fileURLToPath } from "node:url"

/**
 * Where this server keeps its cloud link (cloud-config.json) and sync state. The Electron hub passes
 * its user-data folder (TITAN_DATA_DIR) so an update, which replaces the install directory, keeps
 * them (apps/electron/src/hubConfig.ts). Otherwise: apps/api/data, as before.
 */
export function dataDir(): string {
  return process.env.TITAN_DATA_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data")
}
