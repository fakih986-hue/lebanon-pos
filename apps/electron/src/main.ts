/**
 * Lebanon POS — Electron Main Process
 *
 * Lifecycle:
 *   1. Single-instance lock (prevent duplicate windows)
 *   2. Spawn Express API as a child process (production only)
 *   3. Poll /api/health until ready (max 30s)
 *   4. Open main POS window at http://localhost:3001
 *   5. System tray — closing window hides to tray (server keeps running)
 *   6. Tray → Quit kills the API process and exits cleanly
 */

import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  dialog,
  ipcMain,
  nativeImage,
  shell,
} from "electron"
import { spawn, type ChildProcess } from "node:child_process"
import os   from "node:os"
import path from "node:path"

// ─── Paths ───────────────────────────────────────────────────────────────────

// In production (.exe), the API is bundled into the resources directory.
// In development, the API is run separately — Electron just opens the window.
const API_DIR = app.isPackaged
  ? path.join(process.resourcesPath, "api")
  : path.join(__dirname, "../../../apps/api")

const API_ENTRY  = path.join(API_DIR, "dist/index.js")
const ICON_PNG   = path.join(__dirname, "../assets/icon.png")
const API_URL    = "http://localhost:3001"
const HEALTH_URL = `${API_URL}/api/health`

// ─── State ───────────────────────────────────────────────────────────────────

let mainWindow:  BrowserWindow | null = null
let loadWindow:  BrowserWindow | null = null
let tray:        Tray          | null = null
let apiProcess:  ChildProcess  | null = null
let isQuitting = false

// ─── Single instance lock ────────────────────────────────────────────────────

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
  process.exit(0)
}

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized() || !mainWindow.isVisible()) mainWindow.show()
    mainWindow.focus()
  }
})

// ─── App ready ───────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  // In production, spawn the API; in dev the developer runs it manually
  if (app.isPackaged) {
    spawnApi()
  }

  showLoadingWindow()

  const ready = await waitForApi()
  if (!ready) {
    dialog.showErrorBox(
      "Lebanon POS — Startup Failed",
      "The POS server could not start within 30 seconds.\n\n" +
      "Please check that PostgreSQL is running and try again.\n\n" +
      `API path: ${API_ENTRY}`
    )
    app.quit()
    return
  }

  closeLoadingWindow()
  createMainWindow()
  createTray()
})

// ─── Spawn API ───────────────────────────────────────────────────────────────

function spawnApi(): void {
  // Use process.execPath (Electron's bundled Node.js) so the .exe works on
  // machines without Node.js installed on PATH.
  apiProcess = spawn(process.execPath, [API_ENTRY], {
    cwd:   API_DIR,
    env:   { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  })

  apiProcess.stdout?.on("data", (d: Buffer) => process.stdout.write(`[api] ${d}`))
  apiProcess.stderr?.on("data", (d: Buffer) => process.stderr.write(`[api] ${d}`))

  apiProcess.on("exit", (code) => {
    if (!isQuitting && code !== 0) {
      dialog.showErrorBox(
        "Lebanon POS — Server Stopped",
        `The API server exited unexpectedly (code ${code}).\nThe app will now close.`
      )
      app.quit()
    }
  })
}

// ─── Health poll ─────────────────────────────────────────────────────────────

async function waitForApi(maxMs = 30_000): Promise<boolean> {
  const deadline = Date.now() + maxMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(1_000) })
      if (res.ok) return true
    } catch {
      // not ready yet
    }
    await sleep(500)
  }
  return false
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ─── Loading window ──────────────────────────────────────────────────────────

function showLoadingWindow(): void {
  loadWindow = new BrowserWindow({
    width:           400,
    height:          240,
    resizable:       false,
    frame:           false,
    alwaysOnTop:     true,
    backgroundColor: "#1a1a2e",
    webPreferences:  { nodeIntegration: false, contextIsolation: true },
  })

  // Inline HTML so no separate file is needed
  loadWindow.loadURL(
    `data:text/html,<!DOCTYPE html><html><body style="margin:0;display:flex;` +
    `flex-direction:column;align-items:center;justify-content:center;height:100vh;` +
    `background:#1a1a2e;color:#e2e8f0;font-family:sans-serif;">` +
    `<div style="font-size:24px;font-weight:700;margin-bottom:12px">🏪 Lebanon POS</div>` +
    `<div style="font-size:14px;color:#94a3b8">Starting server, please wait…</div>` +
    `</body></html>`
  )
}

function closeLoadingWindow(): void {
  loadWindow?.close()
  loadWindow = null
}

// ─── Main window ─────────────────────────────────────────────────────────────

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width:  1600,
    height: 900,
    show:   false,
    webPreferences: {
      preload:         path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  mainWindow.loadURL(API_URL)

  mainWindow.once("ready-to-show", () => mainWindow?.show())

  // Close → hide to tray (keeps the API server running)
  mainWindow.on("close", (e) => {
    if (!isQuitting) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: "deny" }
  })
}

// ─── System tray ─────────────────────────────────────────────────────────────

function createTray(): void {
  const icon = nativeImage.createFromPath(ICON_PNG)
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon)
  tray.setToolTip("Lebanon POS")

  const menu = Menu.buildFromTemplate([
    {
      label: "Open POS",
      click: () => { mainWindow?.show(); mainWindow?.focus() },
    },
    { type: "separator" },
    {
      label: "Open in Browser",
      click: () => shell.openExternal(API_URL),
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        isQuitting = true
        app.quit()
      },
    },
  ])

  tray.setContextMenu(menu)
  tray.on("double-click", () => { mainWindow?.show(); mainWindow?.focus() })
}

// ─── IPC handlers ────────────────────────────────────────────────────────────

// Expose local IP to the renderer so the POS can show
// "Other devices: http://192.168.x.x:3001"
ipcMain.handle("get-local-ip", (): string => {
  const interfaces = os.networkInterfaces()
  for (const ifaces of Object.values(interfaces)) {
    for (const iface of ifaces ?? []) {
      if (iface.family === "IPv4" && !iface.internal) return iface.address
    }
  }
  return "localhost"
})

// ─── Shutdown ────────────────────────────────────────────────────────────────

app.on("before-quit", () => {
  isQuitting = true
})

app.on("will-quit", () => {
  if (apiProcess && !apiProcess.killed) {
    apiProcess.kill("SIGTERM")
  }
})

// macOS: clicking dock icon re-shows the window
app.on("activate", () => {
  if (mainWindow) {
    mainWindow.show()
  }
})
