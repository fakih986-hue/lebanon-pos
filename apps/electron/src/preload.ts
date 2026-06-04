/**
 * Electron Preload Script
 *
 * Exposes a minimal, safe API to the renderer (POS web app) via contextBridge.
 * The renderer cannot access Node.js directly — only what's exposed here.
 */

import { contextBridge, ipcRenderer } from "electron"

contextBridge.exposeInMainWorld("electronAPI", {
  /** Returns the server machine's LAN IP for "Other devices: http://x.x.x.x:3001" */
  getLocalIP: (): Promise<string> => ipcRenderer.invoke("get-local-ip"),

  /** Returns the current app version string */
  getAppVersion: (): Promise<string> => ipcRenderer.invoke("get-app-version"),
})
