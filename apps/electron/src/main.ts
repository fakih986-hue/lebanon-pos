/**
 * Lebanon POS — Electron Main Process
 *
 * Full offline-first lifecycle — zero setup for store owners:
 *   1. Single-instance lock
 *   2. Start bundled PostgreSQL (pg_ctl / initdb from assets/pg/)
 *   3. Run Prisma migrations
 *   4. Spawn the Express API
 *   5. Poll /api/health until ready
 *   6. Open POS window + system tray
 *   7. On quit: stop API → stop PostgreSQL gracefully
 */

import {
  app, BrowserWindow, Menu, Tray,
  dialog, ipcMain, nativeImage, shell,
} from "electron"
import { autoUpdater }       from "electron-updater"
import { Client }            from "pg"
import { spawn, execSync as _execSync, type ChildProcess } from "node:child_process"

// execSync wrapper — only used for pg_ctl and initdb, never for Prisma CLI
function execSync(cmd: string, opts?: Parameters<typeof _execSync>[1]) {
  return _execSync(cmd, opts)
}
import os     from "node:os"
import path   from "node:path"
import fs     from "node:fs"
import crypto from "node:crypto"

// ─── Paths ───────────────────────────────────────────────────────────────────

const IS_PACKAGED = app.isPackaged
const USER_DATA   = app.getPath("userData")

// Bundled API (esbuild single-file CJS bundle in production)
const API_DIR   = IS_PACKAGED
  ? path.join(process.resourcesPath, "api")
  : path.join(__dirname, "../../../apps/api")
const API_ENTRY = IS_PACKAGED
  ? path.join(API_DIR, "index.cjs")
  : path.join(API_DIR, "dist/index.js")

// Bundled PostgreSQL binaries (flat directory, no symlinks)
const PG_BIN_DIR = IS_PACKAGED
  ? path.join(process.resourcesPath, "pg", "bin")
  : path.join(__dirname, "../assets/pg/bin")

const ICON_PNG   = path.join(__dirname, "../assets/icon.png")
const ICON_ICO   = path.join(__dirname, "../assets/icon.ico")
const API_URL    = "http://localhost:3001"

// Pre-baked Railway URL written into the hub's .env so the cloud bridge knows
// where to sync. Tenant ID + per-tenant key are entered later in Settings → Cloud.
const CLOUD_API_URL = process.env.LBPOS_CLOUD_URL || "https://lebanon-pos-production.up.railway.app"
const HEALTH_URL = `${API_URL}/api/health`
const ENV_PATH   = path.join(USER_DATA, ".env")
const PG_DATA    = path.join(USER_DATA, "pgdata")
const PG_PORT    = 5433   // use 5433 to avoid conflict with any existing PG install
const PG_USER    = "lbpos"
const PG_DB      = "lebanonpos"

// ─── State ───────────────────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null
let loadWindow: BrowserWindow | null = null
let tray:       Tray          | null = null
let apiProcess: ChildProcess  | null = null
let pgProcess:  ChildProcess  | null = null
let isQuitting  = false
let loadMsg     = "Initializing…"

// ─── Single instance ─────────────────────────────────────────────────────────

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) { app.quit(); process.exit(0) }
app.on("second-instance", () => {
  if (mainWindow) { if (mainWindow.isMinimized() || !mainWindow.isVisible()) mainWindow.show(); mainWindow.focus() }
})

// ─── Boot ────────────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  fs.mkdirSync(USER_DATA, { recursive: true })
  showLoadingWindow()

  try {
    const pgPassword = getPgPassword()

    setStatus("Starting database…")
    await startPostgres(pgPassword)

    setStatus("Configuring server…")
    writeApiEnv(pgPassword)

    setStatus("Applying database migrations…")
    await runMigrations(pgPassword)

    setStatus("Starting POS server…")
    spawnApi()

    setStatus("Waiting for server…")
    if (!await waitForApi()) throw new Error("Server did not respond within 45 seconds.")

  } catch (err: unknown) {
    closeLoadingWindow()
    dialog.showErrorBox(
      "Lebanon POS — Startup Error",
      (err instanceof Error ? err.message : String(err)) + "\n\nContact support if this persists."
    )
    await stopPostgres()
    app.quit()
    return
  }

  closeLoadingWindow()
  createMainWindow()
  createTray()
  if (IS_PACKAGED) setupAutoUpdater()
})

// ─── PostgreSQL management ───────────────────────────────────────────────────

/** Returns a stable random password stored in userData — survives app updates */
function getPgPassword(): string {
  const f = path.join(USER_DATA, ".pgpass")
  if (fs.existsSync(f)) return fs.readFileSync(f, "utf-8").trim()
  const pw = crypto.randomBytes(24).toString("hex")
  fs.writeFileSync(f, pw, { mode: 0o600 })
  return pw
}

const pgExe = (exe: string) => path.join(PG_BIN_DIR, exe + (process.platform === "win32" ? ".exe" : ""))

/**
 * Real usability probe: can we actually open a connection on our port?
 * This is stronger than `pg_ctl status`, which reports false-positives for
 * orphaned/zombie postgres child processes that aren't serving the port.
 */
async function canConnectPg(password: string): Promise<boolean> {
  const client = new Client({
    host: "localhost", port: PG_PORT, user: PG_USER, password,
    database: "postgres", connectionTimeoutMillis: 2000,
  })
  try {
    await client.connect()
    await client.end()
    return true
  } catch {
    try { await client.end() } catch { /* ignore */ }
    return false
  }
}

/** Remove a stale postmaster.pid (left by a crashed/killed server). */
function clearStalePidFile(): void {
  const pid = path.join(PG_DATA, "postmaster.pid")
  if (fs.existsSync(pid)) {
    try { fs.unlinkSync(pid); console.log("[pg] removed stale postmaster.pid") } catch { /* ignore */ }
  }
}

async function startPostgres(password: string): Promise<void> {
  const initdb = pgExe("initdb")
  const pgCtl  = pgExe("pg_ctl")

  // Already serving on our port (previous instance still up)? Reuse it.
  if (await canConnectPg(password)) {
    console.log("[pg] server already accepting connections — reusing")
    return
  }

  // First run: initialize the data directory
  const isNew = !fs.existsSync(path.join(PG_DATA, "PG_VERSION"))
  if (isNew) {
    setStatus("Initializing database (first run)…")
    const pwFile = path.join(USER_DATA, ".pg_init_pw")
    fs.writeFileSync(pwFile, password)
    try {
      execSync(
        `"${initdb}" --pgdata="${PG_DATA}" --username=${PG_USER} --pwfile="${pwFile}" --encoding=UTF8 --locale=C`,
        { stdio: "pipe", env: { ...process.env, PGPASSWORD: password } }
      )
    } finally {
      fs.unlinkSync(pwFile)
    }
    // Write pg_hba.conf to allow local password auth
    const hba = path.join(PG_DATA, "pg_hba.conf")
    fs.writeFileSync(hba, [
      "# TYPE  DATABASE  USER      ADDRESS    METHOD",
      `local   all       ${PG_USER}             md5`,
      `host    all       ${PG_USER}  127.0.0.1/32  md5`,
      `host    all       ${PG_USER}  ::1/128        md5`,
    ].join("\n"))
  } else {
    // Existing data dir but server not running — clear any stale lock first
    clearStalePidFile()
  }

  // Start the server via pg_ctl. Log to a file so failures are diagnosable.
  const pgLog = path.join(USER_DATA, "pg.log")
  try {
    execSync(
      `"${pgCtl}" start --pgdata="${PG_DATA}" --wait --timeout=30 -l "${pgLog}" -o "-p ${PG_PORT}"`,
      { stdio: "pipe", env: process.env }
    )
  } catch (err) {
    // Surface the Postgres log tail so the error dialog is actionable
    let tail = ""
    try { tail = fs.readFileSync(pgLog, "utf-8").split(/\r?\n/).slice(-12).join("\n") } catch { /* no log */ }
    throw new Error(
      `PostgreSQL failed to start.\n${(err as Error).message}\n\n--- pg.log ---\n${tail}`
    )
  }

  // Create the application database on first run
  if (isNew) {
    setStatus("Creating database…")
    const client = new Client({ host: "localhost", port: PG_PORT, user: PG_USER, password, database: "postgres" })
    await client.connect()
    try {
      await client.query(`CREATE DATABASE ${PG_DB}`)
    } finally {
      await client.end()
    }
  }
}

async function stopPostgres(): Promise<void> {
  const pgCtl = path.join(PG_BIN_DIR, "pg_ctl" + (process.platform === "win32" ? ".exe" : ""))
  if (!fs.existsSync(path.join(PG_DATA, "PG_VERSION"))) return
  try {
    execSync(`"${pgCtl}" stop --pgdata="${PG_DATA}" --mode=fast --wait`, { stdio: "pipe" })
  } catch { /* may already be stopped */ }
}

// ─── API configuration & spawn ───────────────────────────────────────────────

function writeApiEnv(pgPassword: string): void {
  if (fs.existsSync(ENV_PATH)) return   // preserve existing config (cloud sync credentials)

  const jwt       = crypto.randomBytes(32).toString("hex")
  const adminPass = crypto.randomBytes(12).toString("base64url")
  const dbUrl     = `postgresql://${PG_USER}:${encodeURIComponent(pgPassword)}@localhost:${PG_PORT}/${PG_DB}`

  fs.writeFileSync(ENV_PATH, [
    `DATABASE_URL="${dbUrl}"`,
    `JWT_SECRET="${jwt}"`,
    `PORT=3001`,
    `ADMIN_PASSWORD="${adminPass}"`,
    // LAN clients connect to the hub by IP, so allow any origin on the local network
    `CORS_ORIGINS=`,
    ``,
    // Cloud bridge: URL is pre-baked; tenant ID + key are entered in Settings → Cloud
    // (persisted to data/cloud-config.json). IS_LOCAL_SERVER keeps the bridge enabled.
    `IS_LOCAL_SERVER=true`,
    `CLOUD_API_URL=${CLOUD_API_URL}`,
    ``,
    `# Admin portal password: ${adminPass}`,
  ].join("\n"), { mode: 0o600 })

  // Show admin password once on first run
  dialog.showMessageBox({
    type: "info", title: "Lebanon POS — Setup Complete",
    message: "Your admin portal password:",
    detail:  `${adminPass}\n\nYou can view or reset it anytime from the tray icon.`,
    buttons: ["Got it"],
  })
}

/**
 * Apply Prisma migrations using raw SQL + the pg client.
 * No Prisma CLI binary needed — works in both dev and packaged mode.
 * Replicates what `prisma migrate deploy` does under the hood:
 *   1. Create the _prisma_migrations tracking table
 *   2. Read migration directories in chronological order
 *   3. Skip migrations already recorded as applied
 *   4. Execute the SQL, record in _prisma_migrations
 */
async function runMigrations(pgPassword: string): Promise<void> {
  const client = new Client({
    host: "localhost", port: PG_PORT,
    user: PG_USER, password: pgPassword,
    database: PG_DB,
  })
  await client.connect()

  try {
    // Create Prisma's migration tracking table (matches Prisma's own schema)
    await client.query(`
      CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
        id                    VARCHAR(36)  PRIMARY KEY NOT NULL,
        checksum              VARCHAR(64)  NOT NULL,
        finished_at           TIMESTAMPTZ,
        migration_name        TEXT         NOT NULL,
        logs                  TEXT,
        rolled_back_at        TIMESTAMPTZ,
        started_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        applied_steps_count   INT          NOT NULL DEFAULT 0
      )
    `)

    const migrationsDir = path.join(API_DIR, "prisma/migrations")
    if (!fs.existsSync(migrationsDir)) {
      console.log("[migrations] no migrations directory found, skipping")
      return
    }

    // Get already-applied migration names
    const { rows } = await client.query<{ migration_name: string }>(
      `SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY started_at`
    )
    const applied = new Set(rows.map(r => r.migration_name))

    // Read migration dirs in chronological order (they start with a timestamp)
    const dirs = fs.readdirSync(migrationsDir)
      .filter(d => /^\d{14}_/.test(d))
      .sort()

    for (const dir of dirs) {
      if (applied.has(dir)) continue

      const sqlFile = path.join(migrationsDir, dir, "migration.sql")
      if (!fs.existsSync(sqlFile)) continue

      const sql = fs.readFileSync(sqlFile, "utf-8")
      const id  = crypto.randomUUID()

      console.log(`[migrations] applying ${dir}`)
      await client.query(`
        INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at, applied_steps_count)
        VALUES ($1, 'electron-runner', $2, NOW(), 0)
      `, [id, dir])

      try {
        await client.query(sql)
        await client.query(`
          UPDATE "_prisma_migrations"
          SET finished_at = NOW(), applied_steps_count = 1
          WHERE id = $1
        `, [id])
        console.log(`[migrations] ✓ ${dir}`)
      } catch (err: unknown) {
        await client.query(`
          UPDATE "_prisma_migrations"
          SET logs = $2, rolled_back_at = NOW()
          WHERE id = $1
        `, [id, err instanceof Error ? err.message : String(err)])
        throw new Error(`Migration ${dir} failed: ${err instanceof Error ? err.message : err}`)
      }
    }

    console.log("[migrations] all migrations applied")
  } finally {
    await client.end()
  }
}

function spawnApi(): void {
  const apiEnv: Record<string, string> = {
    ELECTRON_RUN_AS_NODE: "1",
    PATH:               process.env.PATH ?? "",
    HOME:               process.env.HOME ?? os.homedir(),
    DOTENV_CONFIG_PATH: ENV_PATH,
  }

  apiProcess = spawn(process.execPath, [API_ENTRY], {
    cwd: API_DIR, env: apiEnv,
    stdio: ["ignore", "pipe", "pipe"],
  })
  apiProcess.stdout?.on("data", (d: Buffer) => process.stdout.write(`[api] ${d}`))
  apiProcess.stderr?.on("data", (d: Buffer) => process.stderr.write(`[api] ${d}`))
  apiProcess.on("exit", (code) => {
    if (!isQuitting && code !== 0) {
      dialog.showErrorBox("Lebanon POS", `Server stopped (code ${code}). The app will close.`)
      app.quit()
    }
  })
}

// ─── Health poll ─────────────────────────────────────────────────────────────

async function waitForApi(maxMs = 45_000): Promise<boolean> {
  const deadline = Date.now() + maxMs
  while (Date.now() < deadline) {
    try { const r = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(2_000) }); if (r.ok) return true } catch { }
    await sleep(600)
  }
  return false
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

// ─── Loading window ──────────────────────────────────────────────────────────

function setStatus(msg: string) {
  loadMsg = msg
  loadWindow?.webContents.executeJavaScript(
    `document.getElementById('s')&&(document.getElementById('s').textContent=${JSON.stringify(msg)})`
  ).catch(() => {})
}

function showLoadingWindow() {
  loadWindow = new BrowserWindow({
    width: 440, height: 280, resizable: false, frame: false,
    center: true, alwaysOnTop: true, backgroundColor: "#0f172a",
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  })
  loadWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<!DOCTYPE html>
<html><body style="margin:0;display:flex;flex-direction:column;align-items:center;
justify-content:center;height:100vh;background:#0f172a;color:#e2e8f0;font-family:system-ui;
-webkit-app-region:drag">
<div style="font-size:52px;margin-bottom:14px">🏪</div>
<div style="font-size:20px;font-weight:700;margin-bottom:8px">Lebanon POS</div>
<div id="s" style="font-size:13px;color:#94a3b8;margin-bottom:24px">${loadMsg}</div>
<div style="width:220px;height:3px;background:#1e293b;border-radius:9px;overflow:hidden">
<div style="width:40%;height:100%;background:linear-gradient(90deg,#6366f1,#8b5cf6);
animation:s 1.4s ease-in-out infinite alternate;border-radius:9px"></div></div>
<style>@keyframes s{from{margin-left:0}to{margin-left:60%}}</style>
</body></html>`)}`)
}

function closeLoadingWindow() { loadWindow?.close(); loadWindow = null }

// ─── Main window ─────────────────────────────────────────────────────────────

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1600, height: 900, minWidth: 1024, minHeight: 600,
    show: false, title: "Lebanon POS",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false, contextIsolation: true,
    },
  })
  mainWindow.loadURL(API_URL)
  mainWindow.once("ready-to-show", () => mainWindow?.show())
  mainWindow.on("close", e => { if (!isQuitting) { e.preventDefault(); mainWindow?.hide() } })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" } })
}

// ─── Tray ────────────────────────────────────────────────────────────────────

function createTray() {
  const iconPath = fs.existsSync(ICON_ICO) ? ICON_ICO : ICON_PNG
  const icon = nativeImage.createFromPath(iconPath)
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon)
  tray.setToolTip("Lebanon POS")
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open POS", click: () => { mainWindow?.show(); mainWindow?.focus() } },
    { type: "separator" },
    { label: "Open in Browser", click: () => shell.openExternal(API_URL) },
    { type: "separator" },
    {
      label: "Show Admin Password", click: () => {
        try {
          const env = fs.readFileSync(ENV_PATH, "utf-8")
          const m = env.match(/ADMIN_PASSWORD="([^"]+)"/)
          dialog.showMessageBox({ type: "info", title: "Admin Password",
            message: "Owner portal password:", detail: m?.[1] ?? "(not found)", buttons: ["OK"] })
        } catch { dialog.showErrorBox("Error", "Could not read config.") }
      },
    },
    {
      label: "Reset Admin Password", click: async () => {
        const { response } = await dialog.showMessageBox({
          type: "question", title: "Reset Password",
          message: "Generate a new admin password? The old one will stop working.",
          buttons: ["Cancel", "Reset"],
        })
        if (response === 1) {
          const newPw = crypto.randomBytes(12).toString("base64url")
          let env = fs.readFileSync(ENV_PATH, "utf-8")
          env = env.replace(/ADMIN_PASSWORD="[^"]*"/, `ADMIN_PASSWORD="${newPw}"`)
          fs.writeFileSync(ENV_PATH, env)
          dialog.showMessageBox({ type: "info", title: "Password Reset",
            message: "New admin password:", detail: newPw, buttons: ["OK"] })
        }
      },
    },
    { type: "separator" },
    { label: "Check for Updates", click: () => autoUpdater.checkForUpdates().catch(() => {}) },
    { type: "separator" },
    { label: "Quit Lebanon POS", click: () => { isQuitting = true; app.quit() } },
  ]))
  tray.on("double-click", () => { mainWindow?.show(); mainWindow?.focus() })
}

// ─── Auto-updater ─────────────────────────────────────────────────────────────

function setupAutoUpdater() {
  autoUpdater.logger = null
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on("update-available", info => {
    dialog.showMessageBox({ type: "info", title: "Update Available",
      message: `Lebanon POS v${info.version} is available and will install when you quit.`,
      buttons: ["OK"] })
  })
  autoUpdater.on("error", e => console.error("[updater]", e.message))
  setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 10_000)
}

// ─── IPC ─────────────────────────────────────────────────────────────────────

ipcMain.handle("get-local-ip", () => {
  for (const ifaces of Object.values(os.networkInterfaces()))
    for (const iface of ifaces ?? [])
      if (iface.family === "IPv4" && !iface.internal) return iface.address
  return "localhost"
})
ipcMain.handle("get-app-version", () => app.getVersion())

// ─── Shutdown ────────────────────────────────────────────────────────────────

app.on("before-quit", () => { isQuitting = true })

app.on("will-quit", async e => {
  e.preventDefault()
  try {
    if (apiProcess && !apiProcess.killed) { apiProcess.kill("SIGTERM"); await sleep(1500) }
    await stopPostgres()
  } catch { /* ignore */ }
  app.exit(0)
})

app.on("activate", () => { if (mainWindow) mainWindow.show() })
