/**
 * Electron Preload Script
 *
 * Exposes a minimal, safe API to the renderer (POS web app) via contextBridge.
 * The renderer cannot access Node.js directly — only what's exposed here.
 */

import { contextBridge, ipcRenderer } from "electron"

// Tell the SPA it is running on the hub: talk to the local API on this machine,
// and show the pre-baked Railway URL (read-only) in Settings → Cloud.
contextBridge.exposeInMainWorld("__LBPOS_API_URL__", "http://localhost:3015")
contextBridge.exposeInMainWorld(
  "__LBPOS_CLOUD_URL__",
  process.env.CLOUD_API_URL || "https://lebanon-pos-production.up.railway.app"
)

contextBridge.exposeInMainWorld("electronAPI", {
  /** Returns the server machine's LAN IP for "Other devices: http://x.x.x.x:3015" */
  getLocalIP: (): Promise<string> => ipcRenderer.invoke("get-local-ip"),

  /** Returns the current app version string */
  getAppVersion: (): Promise<string> => ipcRenderer.invoke("get-app-version"),

  /** Returns the current BIND_HOST from the API .env file */
  getBindHost: (): Promise<string> => ipcRenderer.invoke("get-bind-host"),

  /** Sets BIND_HOST to 0.0.0.0 (hub/LAN mode) or 127.0.0.1 (local-only) and restarts the API */
  setBindHost: (value: "0.0.0.0" | "127.0.0.1"): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("set-bind-host", value),
})
