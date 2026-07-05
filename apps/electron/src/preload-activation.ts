/**
 * Electron Preload Script for Activation Window
 *
 * Exposes a minimal, safe API to the activation wizard via contextBridge.
 * The activation window uses contextIsolation: true, nodeIntegration: false.
 */

import { contextBridge, ipcRenderer } from "electron"

contextBridge.exposeInMainWorld("activationAPI", {
  getAdminPassword: (): Promise<string> => ipcRenderer.invoke("activation-get-password"),
  getCloudUrl: (): Promise<string> => ipcRenderer.invoke("activation-get-cloud-url"),
  getApiUrl: (): Promise<string> => ipcRenderer.invoke("activation-get-api-url"),
  discover: (subdomain: string, pin: string): Promise<{ ok: boolean; error?: string; data?: any }> =>
    ipcRenderer.invoke("activation-discover", { subdomain, pin }),
  saveCloudConfig: (tenantId: string, apiKey: string, adminPassword: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("activation-save-cloud-config", { tenantId, apiKey, adminPassword }),
  done: () => ipcRenderer.send("activation-done"),
})
