/**
 * Electron Preload Script
 *
 * Exposes a minimal, safe API to the renderer (POS web app) via contextBridge.
 * The renderer cannot access Node.js directly — only what's exposed here.
 */

import { contextBridge, ipcRenderer } from "electron"

contextBridge.exposeInMainWorld("electronAPI", {
  /**
   * Returns the server machine's LAN IP address.
   * The POS can show "Other devices: http://192.168.x.x:3001" to the cashier.
   */
  getLocalIP: (): Promise<string> => ipcRenderer.invoke("get-local-ip"),
})
