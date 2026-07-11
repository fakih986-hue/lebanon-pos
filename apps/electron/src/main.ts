/**
 * Titan POS — Electron Main Process
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
const ICON_EMBED_PNG = path.join(__dirname, "../assets/icon-embed.png")

// The real Titan shield mark, inlined as a data URI for the loading/activation
// windows — those load via `data:text/html` URLs, where relative/file:// image
// paths aren't reliably reachable, so the logo has to travel with the HTML.
// IMPORTANT: use the small icon-embed.png (256², ~85KB), not the full 1024²
// icon.png (~1.7MB → ~2.3MB base64, further inflated by encodeURIComponent) —
// embedding the full-size icon here made Chromium visibly stall parsing the
// multi-megabyte data: URL before it could paint anything, showing as a
// several-second black window on every first-run activation screen.
const TITAN_MARK_DATA_URI = fs.existsSync(ICON_EMBED_PNG)
  ? `data:image/png;base64,${fs.readFileSync(ICON_EMBED_PNG).toString("base64")}`
  : ""
const API_URL    = "http://localhost:3015"

// Pre-baked Railway URL written into the hub's .env so the cloud bridge knows
// where to sync. Tenant ID + per-tenant key are entered later in Settings → Cloud.
const CLOUD_API_URL = process.env.LBPOS_CLOUD_URL || "https://pos.titan-suite.net"
const HEALTH_URL = `${API_URL}/api/health`
const ENV_PATH   = path.join(USER_DATA, ".env")
const PG_DATA    = path.join(USER_DATA, "pgdata")
const PG_PORT    = 5434   // 5433 conflicts with global PG installations; moved to 5434
const PG_USER    = "lbpos"
const PG_DB      = "lebanonpos"

// ─── State ───────────────────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null
let loadWindow: BrowserWindow | null = null
let tray:       Tray          | null = null
let apiProcess: ChildProcess  | null = null
let pgProcess:  ChildProcess  | null = null
let isQuitting  = false
const API_MAX_RESTARTS = 3
let apiRestartCount = 0
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
    apiRestartCount = 0 // Reset on successful start

  } catch (err: unknown) {
    closeLoadingWindow()
    dialog.showErrorBox(
      "Titan POS — Startup Error",
      (err instanceof Error ? err.message : String(err)) + "\n\nContact support if this persists."
    )
    await stopPostgres()
    app.quit()
    return
  }

  // Check if cloud is already configured — if not, show activation screen
  try {
    const res = await fetch(`${API_URL}/api/setup/cloud-config`, {
      signal: AbortSignal.timeout(5_000),
    })
    if (res.ok) {
      const status = await res.json() as { configured: boolean }
      if (!status.configured) {
        showActivationWindow()
        return // activation-done IPC event will continue to createMainWindow
      }
    }
  } catch { /* demo mode — skip activation */ }

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

  // Already serving on our port (previous instance still up)? Reuse it.
  if (await canConnectPg(password)) {
    console.log("[pg] server already accepting connections — reusing")
    await ensureDatabase(password)
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
    const hba = path.join(PG_DATA, "pg_hba.conf")
    fs.writeFileSync(hba, [
      "# TYPE  DATABASE  USER      ADDRESS    METHOD",
      `local   all       ${PG_USER}             md5`,
      `host    all       ${PG_USER}  127.0.0.1/32  md5`,
      `host    all       ${PG_USER}  ::1/128        md5`,
    ].join("\n"))
  } else {
    clearStalePidFile()
  }

  // Start postgres directly (pg_ctl PID detection is unreliable with bundled PG on Windows)
  const pgLog = path.join(USER_DATA, "pg.log")
  const pgLogFd = fs.openSync(pgLog, "a")
  pgProcess = spawn(pgExe("postgres"), ["-D", PG_DATA, "-p", String(PG_PORT)], {
    stdio: ["ignore", pgLogFd, pgLogFd],
    windowsHide: true,
    env: process.env,
  })
  fs.closeSync(pgLogFd)

  // Poll for readiness (up to 30 seconds)
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (await canConnectPg(password)) break
    await sleep(500)
  }
  if (!await canConnectPg(password)) {
    let tail = ""
    try { tail = fs.readFileSync(pgLog, "utf-8").split(/\r?\n/).slice(-12).join("\n") } catch { /* no log */ }
    throw new Error(`PostgreSQL did not become ready within 30 seconds.\n\n--- pg.log ---\n${tail}`)
  }

  await ensureDatabase(password)
}

/** Idempotently create the application database if it's missing. */
async function ensureDatabase(password: string): Promise<void> {
  setStatus("Preparing database…")

  // Prefer system psql (avoid pg.Client compatibility issues in Electron's bundled Node)
  const psqlPath = "C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe"
  if (fs.existsSync(psqlPath)) {
    const psqlEnv = { ...process.env, PGPASSWORD: password }
    const commonArgs = `-h localhost -p ${PG_PORT} -U ${PG_USER} -d postgres`
    try {
      const result = execSync(
        `"${psqlPath}" ${commonArgs} -t -A -c "SELECT 1 FROM pg_database WHERE datname = '${PG_DB}'"`,
        { encoding: "utf-8", env: psqlEnv }
      ).toString().trim()
      if (!result) {
        setStatus("Creating database…")
        execSync(`"${psqlPath}" ${commonArgs} -c "CREATE DATABASE ${PG_DB}"`, { env: psqlEnv })
        console.log(`[pg] created database ${PG_DB}`)
      } else {
        console.log(`[pg] database ${PG_DB} already exists`)
      }
      return
    } catch (err) {
      console.log("[pg] psql check failed:", (err as Error).message)
    }
  } else {
    console.log("[pg] system psql not found, using pg.Client")
  }

  // Fallback: pg.Client
  const client = new Client({ host: "localhost", port: PG_PORT, user: PG_USER, password, database: "postgres" })
  await client.connect()
  try {
    const { rows } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [PG_DB])
    if (rows.length === 0) {
      setStatus("Creating database…")
      await client.query(`CREATE DATABASE "${PG_DB}"`)
      console.log(`[pg] created database ${PG_DB}`)
    } else {
      console.log(`[pg] database ${PG_DB} already exists`)
    }
  } finally {
    await client.end()
  }
}

async function stopPostgres(): Promise<void> {
  if (!fs.existsSync(path.join(PG_DATA, "PG_VERSION"))) return

  // Try graceful shutdown via pg_ctl first
  try {
    const pgCtlExe = (name: string) => path.join(USER_DATA, "assets", "pg", "bin", `${name}.exe`)
    execSync(`"${pgCtlExe("pg_ctl")}" -D "${PG_DATA}" stop -m fast -w -t 10`, { stdio: "pipe", timeout: 15000 })
    console.log("[pg] stopped gracefully via pg_ctl")
    return
  } catch {
    // pg_ctl failed — fall back to killing the tracked process
    if (pgProcess && !pgProcess.killed) {
      try {
        pgProcess.kill("SIGTERM")
        await new Promise<void>((resolve) => {
          pgProcess!.once("exit", () => resolve())
          setTimeout(() => resolve(), 5000) // timeout after 5s
        })
        console.log("[pg] stopped via SIGTERM on tracked process")
        return
      } catch { /* fall through to taskkill */ }
    }
  }

  // Last resort: kill by port
  try {
    const result = execSync(`netstat -ano | findstr ":${PG_PORT}"`, { encoding: "utf-8" }) as string
    const pids = [...result.matchAll(/LISTENING\s+(\d+)/g)].map(m => m[1]).filter((v,i,a) => a.indexOf(v)===i)
    for (const pid of pids) {
      try { execSync(`taskkill /f /pid ${pid}`, { stdio: "pipe" }) } catch { /* already dead */ }
    }
    console.log("[pg] stopped via taskkill (last resort)")
  } catch { /* no process on our port */ }
}

// ─── API configuration & spawn ───────────────────────────────────────────────

function writeApiEnv(pgPassword: string): void {
  const existing: Record<string, string> = {}
  if (fs.existsSync(ENV_PATH)) {
    const envText = fs.readFileSync(ENV_PATH, "utf-8")
    for (const line of envText.split(/\r?\n/)) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (!match) continue
      existing[match[1]] = match[2].replace(/^"|"$/g, "")
    }
  }

  const jwt       = existing.JWT_SECRET || crypto.randomBytes(32).toString("hex")
  const adminPass = existing.ADMIN_PASSWORD || crypto.randomBytes(12).toString("base64url")
  const dbUrl     = `postgresql://${PG_USER}:${encodeURIComponent(pgPassword)}@localhost:${PG_PORT}/${PG_DB}`
  const firstRun  = !existing.ADMIN_PASSWORD

  fs.writeFileSync(ENV_PATH, [
    `DATABASE_URL="${dbUrl}"`,
    `JWT_SECRET="${jwt}"`,
    `PORT=3015`,
    `ADMIN_PASSWORD="${adminPass}"`,
    // Default: bind localhost only. Set BIND_HOST=0.0.0.0 in hub mode for LAN access.
    `BIND_HOST=127.0.0.1`,
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
  if (firstRun) {
  dialog.showMessageBox({
    type: "info", title: "Titan POS — Setup Complete",
    message: "Your admin portal password:",
    detail:  `${adminPass}\n\nYou can view or reset it anytime from the tray icon.`,
    buttons: ["Got it"],
  })
  }
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
  // Preserve critical Windows env vars that native modules (Prisma, pg) need,
  // while still injecting our own config. Passing the full process.env would
  // leak Electron internals into the child.
  const essential = [
    "PATH", "HOME", "TEMP", "TMP", "USERPROFILE",
    "APPDATA", "LOCALAPPDATA", "COMSPEC", "SystemRoot", "WINDIR",
  ]
  const apiEnv: Record<string, string> = {
    ELECTRON_RUN_AS_NODE: "1",
    DOTENV_CONFIG_PATH: ENV_PATH,
    PRISMA_QUERY_ENGINE_LIBRARY: path.join(API_DIR, "generated/prisma/query_engine-windows.dll.node"),
  }
  for (const key of essential) {
    const val = process.env[key]
    if (val) apiEnv[key] = val
  }

  apiProcess = spawn(process.execPath, [API_ENTRY], {
    cwd: API_DIR, env: apiEnv,
    stdio: ["ignore", "pipe", "pipe"],
  })
  apiProcess.stdout?.on("data", (d: Buffer) => process.stdout.write(`[api] ${d}`))
  apiProcess.stderr?.on("data", (d: Buffer) => process.stderr.write(`[api] ${d}`))
  apiProcess.on("exit", (code) => {
    if (isQuitting || code === 0) return
    if (apiRestartCount >= API_MAX_RESTARTS) {
      dialog.showErrorBox("Titan POS", `Server crashed ${API_MAX_RESTARTS} times (code ${code}). Please restart the app.`)
      app.quit()
      return
    }
    apiRestartCount++
    const delay = Math.min(apiRestartCount * 2000, 10000)
    console.log(`[api] crashed (code ${code}), restarting in ${delay}ms (attempt ${apiRestartCount}/${API_MAX_RESTARTS})`)
    setTimeout(() => {
      if (!isQuitting) {
        spawnApi()
        waitForApi().then(ok => {
          if (!ok) console.error("[api] restart failed — health check timed out")
        })
      }
    }, delay)
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
    width: 400, height: 260, resizable: false, frame: false,
    center: true, alwaysOnTop: true, backgroundColor: "#0b0e14",
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  })
  loadWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;
background:#0b0e14;color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
-webkit-app-region:drag;gap:16px;padding:24px}
.logo{width:56px;height:56px;background:#000;border:1px solid rgba(212,175,55,0.3);border-radius:16px;
display:flex;align-items:center;justify-content:center;box-shadow:0 4px 14px rgba(0,0,0,0.5)}
.logo img{width:78%;height:78%;object-fit:contain}
.title{font-size:18px;font-weight:700;letter-spacing:0.04em}
.status{font-size:12px;color:#8a8578;text-align:center;min-height:18px}
.bar{width:200px;height:3px;background:#1c1913;border-radius:99px;overflow:hidden}
.bar-inner{width:35%;height:100%;background:linear-gradient(90deg,#a4841f,#e9c766);
border-radius:99px;animation:slide 1.2s ease-in-out infinite alternate}
@keyframes slide{from{margin-left:-10%}to{margin-left:75%}}
</style></head>
<body>
<div class="logo"><img src="${TITAN_MARK_DATA_URI}" alt=""></div>
<div class="title">Titan POS</div>
<div class="status" id="s">${loadMsg}</div>
<div class="bar"><div class="bar-inner"></div></div>
</body></html>`)}`)
}

function closeLoadingWindow() { loadWindow?.close(); loadWindow = null }

// ─── Activation window (first-run cloud setup) ───────────────────────────

let activationWindow: BrowserWindow | null = null

function showActivationWindow() {
  closeLoadingWindow()
  closeActivationWindow()

  activationWindow = new BrowserWindow({
    width: 500, height: 680, resizable: false,
    center: true, title: "Titan POS — Connect to Cloud",
    backgroundColor: "#0b0e14",
    webPreferences: {
      preload: path.join(__dirname, "preload-activation.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{margin:0;padding:24px;background:#0b0e14;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
display:flex;flex-direction:column;min-height:100vh;color:#e2e8f0}
.header{display:flex;align-items:center;gap:12px;margin-bottom:4px}
.header-icon{width:44px;height:44px;background:#000;border:1px solid rgba(212,175,55,0.3);border-radius:13px;
display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 4px 14px rgba(0,0,0,0.5)}
.header-icon img{width:78%;height:78%;object-fit:contain}
.header-text{font-size:20px;font-weight:800;color:#f1ede4;letter-spacing:0.02em}
.sub{font-size:13px;color:#8a8578;margin-bottom:20px}
.banner{background:rgba(212,168,67,0.12);border:1px solid rgba(212,168,67,0.35);border-radius:10px;padding:14px;margin-bottom:20px}
.banner-title{font-size:12px;font-weight:700;color:#e4bc5c;margin-bottom:6px}
.banner-pw{font-size:18px;font-weight:800;color:#fff;font-family:monospace;letter-spacing:1px;user-select:all}
.banner-hint{font-size:11px;color:#b89b56;margin-top:6px}
.form{display:flex;flex-direction:column;flex:1}
.field{margin-bottom:14px}
.field-label{font-size:12px;font-weight:700;color:#c9c4b8;margin-bottom:5px}
.input{width:100%;height:42px;padding:0 12px;border:1px solid rgba(212,168,67,0.2);border-radius:8px;background:#12151c;
color:#e2e8f0;font-size:13px;outline:none;transition:border-color .15s}
.input:focus{border-color:#d4a843;box-shadow:0 0 0 3px rgba(212,168,67,.15)}
.input-readonly{background:#0f1117;color:#8a8578;font-family:monospace;font-size:12px}
.btn{width:100%;height:46px;border:none;border-radius:10px;background:linear-gradient(135deg,#e9c766,#a4841f);color:#140f04;
font-size:14px;font-weight:700;cursor:pointer;transition:opacity .15s;margin-top:auto}
.btn:hover{opacity:.9}
.btn:disabled{opacity:.5;cursor:not-allowed}
.err{display:none;margin-top:12px;padding:12px;border-radius:8px;background:rgba(239,68,68,0.12);
color:#fca5a5;font-size:13px;font-weight:600}
.hint{font-size:11px;color:#8a8578;margin-top:4px;margin-bottom:0}
.success{display:flex;flex-direction:column;align-items:center;justify-content:center;
text-align:center;padding:40px 24px}
.success-icon{font-size:48px;margin-bottom:12px}
.success-title{font-size:18px;font-weight:700;color:#f1ede4;margin-bottom:8px}
.success-text{font-size:14px;color:#8a8578;margin-bottom:24px}
.store-name{font-size:16px;font-weight:700;color:#4ade80;margin-bottom:4px}
</style></head>
<body>
<div class="header">
<div class="header-icon"><img src="${TITAN_MARK_DATA_URI}" alt=""></div>
<div class="header-text">Titan POS</div>
</div>
<p class="sub">Enter your store subdomain and admin PIN to connect to the cloud.</p>

<div class="banner">
<div class="banner-title">🔑 Admin password — save this</div>
<div class="banner-pw" id="pw">Loading…</div>
<div class="banner-hint">Also available from the tray icon: Show Admin Password</div>
</div>

<form id="f" class="form" onsubmit="return connect()">
<div class="field">
<div class="field-label">Server URL</div>
<input class="input input-readonly" id="url" readonly>
</div>
<div class="field">
<div class="field-label">Store Subdomain</div>
<input class="input" id="sub" placeholder="e.g. fakih" autocomplete="off" pattern="[a-z0-9-]{3,}">
<p class="hint">The subdomain from the owner portal</p>
</div>
<div class="field">
<div class="field-label">Admin PIN</div>
<input class="input" id="pin" type="password" placeholder="Your admin PIN" autocomplete="off">
<p class="hint">The PIN the owner gave you</p>
</div>
<button type="submit" class="btn" id="btn">Connect &amp; Download My Data</button>
<div class="err" id="err"></div>
</form>

<script>
(async function init(){
  const pw=await window.activationAPI.getAdminPassword();
  const url=await window.activationAPI.getCloudUrl();
  document.getElementById('pw').textContent=pw;
  document.getElementById('url').value=url;
})();
async function connect(){
  const btn=document.getElementById('btn'),err=document.getElementById('err'),
    sub=document.getElementById('sub').value.trim(),
    pin=document.getElementById('pin').value.trim();
  if(!sub){err.textContent='Enter your store subdomain';err.style.display='block';return false}
  if(!pin){err.textContent='Enter your admin PIN';err.style.display='block';return false}
  btn.disabled=true;btn.textContent='Connecting…';err.style.display='none';
  try{
    const disc=await window.activationAPI.discover(sub,pin);
    if(!disc.ok) throw new Error(disc.error);
    if(!disc.data.cloudApiKey) throw new Error('This store is missing its cloud API key. Ask the owner to regenerate it from the Owner Portal, then try again.');
    const pw=await window.activationAPI.getAdminPassword();
    const saved=await window.activationAPI.saveCloudConfig(disc.data.tenantId,disc.data.cloudApiKey,pw);
    if(!saved.ok) throw new Error(saved.error);
    document.body.innerHTML='<div class="success">'+
      '<div class="success-icon">✅</div>'+
      '<div class="store-name">'+disc.data.tenantName+'</div>'+
      '<div class="success-title">Store Connected!</div>'+
      '<div class="success-text">Your data has been downloaded. Staff will appear on the login screen.</div>'+
      '</div>';
    setTimeout(()=>{window.activationAPI.done()},2000);
  }catch(e){
    err.textContent=e.message;err.style.display='block';
    btn.disabled=false;btn.textContent='Connect & Download My Data';
  }
  return false;
}
</script>
</body></html>`
  activationWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
}

function closeActivationWindow() { activationWindow?.close(); activationWindow = null }

// ─── Main window ─────────────────────────────────────────────────────────────

function createMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = new BrowserWindow({
      width: 1600, height: 900, minWidth: 1024, minHeight: 600,
      show: false, title: "Titan POS",
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        nodeIntegration: false, contextIsolation: true,
      },
    })
    mainWindow.once("ready-to-show", () => mainWindow?.show())
    mainWindow.on("close", e => { if (!isQuitting) { e.preventDefault(); mainWindow?.hide() } })
    mainWindow.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" } })
  }

  // The SPA handles hub auto-sync itself (preload exposes __LBPOS_API_URL__).
  mainWindow.loadURL(API_URL)
  mainWindow.show()
}

// ─── Tray ────────────────────────────────────────────────────────────────────

function createTray() {
  const iconPath = fs.existsSync(ICON_ICO) ? ICON_ICO : ICON_PNG
  const icon = nativeImage.createFromPath(iconPath)
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon)
  tray.setToolTip("Titan POS")
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
    { label: "Quit Titan POS", click: () => { isQuitting = true; app.quit() } },
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
      message: `Titan POS v${info.version} is available and will install when you quit.`,
      buttons: ["OK"] })
  })
  autoUpdater.on("error", e => console.error("[updater]", e.message))
  setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 10_000)
}

// ─── IPC ─────────────────────────────────────────────────────────────────────

// Activation window IPC handlers (contextIsolation-safe)
ipcMain.handle("activation-get-password", () => {
  try {
    const envContent = fs.readFileSync(ENV_PATH, "utf-8")
    const m = envContent.match(/ADMIN_PASSWORD="([^"]+)"/)
    return m ? m[1] : ""
  } catch { return "" }
})

ipcMain.handle("activation-get-cloud-url", () => CLOUD_API_URL)

ipcMain.handle("activation-get-api-url", () => API_URL)

ipcMain.handle("activation-discover", async (_event, { subdomain, pin }: { subdomain: string; pin: string }) => {
  try {
    const res = await fetch(`${API_URL}/api/setup/discover`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subdomain, pin }),
    })
    const data = await res.json() as Record<string, unknown>
    if (!res.ok) return { ok: false, error: (data.error as string) || "Connection failed" }
    return { ok: true, data }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Connection failed" }
  }
})

ipcMain.handle("activation-save-cloud-config", async (_event, { tenantId, apiKey, adminPassword }: { tenantId: string; apiKey: string; adminPassword: string }) => {
  try {
    const res = await fetch(`${API_URL}/api/setup/cloud-config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId, apiKey, adminPassword }),
    })
    const data = await res.json() as Record<string, unknown>
    if (!res.ok) return { ok: false, error: (data.error as string) || "Failed to save config" }
    if (data.pullError) return { ok: false, error: `Cloud sync failed: ${data.pullError}` }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Connection failed" }
  }
})

ipcMain.handle("get-local-ip", () => {
  for (const ifaces of Object.values(os.networkInterfaces()))
    for (const iface of ifaces ?? [])
      if (iface.family === "IPv4" && !iface.internal) return iface.address
  return "localhost"
})
ipcMain.handle("get-app-version", () => app.getVersion())

ipcMain.handle("get-bind-host", () => {
  try {
    const envText = fs.readFileSync(ENV_PATH, "utf-8")
    const m = envText.match(/^BIND_HOST=(.*)$/m)
    return m ? m[1].replace(/^"|"$/g, "") : "127.0.0.1"
  } catch { return "127.0.0.1" }
})

ipcMain.handle("set-bind-host", async (_event, value: "0.0.0.0" | "127.0.0.1") => {
  try {
    const envText = fs.readFileSync(ENV_PATH, "utf-8")
    const updated = envText.replace(/^BIND_HOST=.*$/m, `BIND_HOST=${value}`)
    fs.writeFileSync(ENV_PATH, updated, { mode: 0o600 })

    // Restart API with new bind host. Wait for the OLD process to actually
    // exit (release the port) before spawning the new one — a fixed sleep
    // here previously raced graceful shutdown (closing DB connections, etc.);
    // if the old process was still holding port 3015 when the new one tried
    // to listen, it hit EADDRINUSE and crashed, tripping the 3-strikes dialog.
    if (apiProcess && !apiProcess.killed) {
      const exited = new Promise<void>((resolve) => {
        apiProcess!.once("exit", () => resolve())
      })
      apiProcess.kill("SIGTERM")
      await Promise.race([exited, sleep(10_000)])
    }
    apiRestartCount = 0
    spawnApi()
    const ok = await waitForApi()
    return { ok, error: ok ? undefined : "API failed to restart with new bind host" }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to set bind host" }
  }
})

// Activation window → main window transition
ipcMain.on("activation-done", () => {
  // The SPA self-syncs on the hub (GET /cloud-config → POST /auto-login → pull),
  // so no token needs to be passed through here.
  closeActivationWindow()
  createMainWindow()
  createTray()
  if (IS_PACKAGED) setupAutoUpdater()
})

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
