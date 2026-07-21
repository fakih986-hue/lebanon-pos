// POS-UPDATE-1: renderer-side wrapper over the Electron auto-updater.
// The heavy lifting (download, SHA512 verify, NSIS install, relaunch) is done by
// electron-updater in the main process; this module just talks to it over the
// preload bridge and normalizes its events into a small phase machine that the
// Settings → About tab renders. In a plain browser (admin/driver clients) there
// is no electronAPI — callers should branch on isElectron().

export type UpdatePhase =
  | "idle"        // not checked yet
  | "checking"    // querying the feed
  | "up-to-date"  // no newer release
  | "available"   // newer release found (not downloaded)
  | "downloading" // download in progress (percent)
  | "downloaded"  // ready to install on restart
  | "error"       // check/download failed
  | "unsupported" // running outside Electron (browser client / dev)

export interface UpdateState {
  phase: UpdatePhase
  version?: string
  notes?: string
  percent?: number
  error?: string
}

type UpdateEvent = { phase: string; version?: string; notes?: string; percent?: number; error?: string }

interface UpdaterAPI {
  getAppVersion?: () => Promise<string>
  checkForUpdate?: () => Promise<{ ok?: boolean; dev?: boolean; version?: string | null; error?: string }>
  downloadUpdate?: () => Promise<{ ok?: boolean; dev?: boolean; error?: string }>
  installUpdate?: () => Promise<{ ok?: boolean; dev?: boolean }>
  onUpdateEvent?: (cb: (payload: UpdateEvent) => void) => () => void
}

function api(): UpdaterAPI | null {
  const a = (window as unknown as { electronAPI?: UpdaterAPI }).electronAPI
  return a && typeof a.onUpdateEvent === "function" ? a : null
}

/** True when running inside the packaged Electron hub app (has the update bridge). */
export function isElectron(): boolean {
  return api() !== null
}

export async function getInstalledVersion(): Promise<string | null> {
  const a = api()
  if (!a?.getAppVersion) return null
  try { return await a.getAppVersion() } catch { return null }
}

/** Subscribe to updater phase changes. Returns an unsubscribe (no-op in browser). */
export function subscribeUpdate(cb: (state: UpdateState) => void): () => void {
  const a = api()
  if (!a?.onUpdateEvent) return () => {}
  return a.onUpdateEvent((p) => {
    const phase = (p.phase as UpdatePhase) ?? "idle"
    cb({ phase, version: p.version, notes: p.notes, percent: p.percent, error: p.error })
  })
}

/** Trigger a feed check. Resolves once the request is sent; results arrive via subscribeUpdate. */
export async function checkForUpdate(): Promise<{ dev: boolean }> {
  const a = api()
  if (!a?.checkForUpdate) return { dev: true }
  const r = await a.checkForUpdate()
  return { dev: r?.dev === true }
}

export async function downloadUpdate(): Promise<void> {
  await api()?.downloadUpdate?.()
}

export async function installUpdate(): Promise<void> {
  await api()?.installUpdate?.()
}
