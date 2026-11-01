#!/usr/bin/env node
// Guarded launcher for installer/hub tests. EVERY start and restart of a test hub goes through this
// script; never start "Titan POS.exe" directly during a test.
//
//   node scripts/it-hub.mjs start --exe <Titan POS.exe> --user-data-dir <scratch dir> --cloud http://127.0.0.1:<port>
//   node scripts/it-hub.mjs stop  --user-data-dir <scratch dir>
//   (start also takes --debug-port <n>: a DevTools port on 127.0.0.1 only, to drive the hub's own window)
//
// Why: the hub rewrites <userData>/.env on every launch with CLOUD_API_URL taken from the launch
// environment (LBPOS_CLOUD_URL), defaulting to PRODUCTION. One restart without it points a test hub
// at production. This launcher makes the local cloud mandatory and watches the hub's network use:
//  - refuses unless --cloud is a loopback URL and --user-data-dir is a scratch dir under the temp
//    folder (never the real %APPDATA%\lebanon-pos);
//  - launches with LBPOS_CLOUD_URL set, then verifies the rewritten .env names that loopback URL
//    (stops the hub at once if not);
//  - outbound watchdog: every second, any TCP connection from the hub's process tree to a
//    non-loopback address stops the hub immediately and is logged to <userData>/it-hub-network.log
//    (the log also proves "no outbound traffic" for a run);
//  - Chromium-level network (auto-update checks etc.) is blocked with --host-resolver-rules;
//  - stop: graceful close first (the hub stops its embedded Postgres), then forced, then any
//    orphaned embedded Postgres from that build (a hard kill leaves one that blocks the next start).
// The hub's cloud credentials live in <install dir>\data\cloud-config.json (shared by every
// user-data dir of that build): test with a dedicated unpacked build or a disposable install.
import { spawn, execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const [cmd, ...rest] = process.argv.slice(2)
const opt = {}
for (let i = 0; i < rest.length; i += 2) opt[rest[i].replace(/^--/, "")] = rest[i + 1]
const fail = (m) => { console.error(`it-hub: REFUSED — ${m}`); process.exit(2) }

const userData = opt["user-data-dir"] && path.resolve(opt["user-data-dir"])
if (!userData) fail("--user-data-dir is required")
const tmp = path.resolve(os.tmpdir()).toLowerCase()
const real = path.resolve(process.env.APPDATA ?? "", "lebanon-pos").toLowerCase()
if (!userData.toLowerCase().startsWith(tmp + path.sep) || userData.toLowerCase() === real) fail(`--user-data-dir must be a scratch dir under ${os.tmpdir()}`)
const stateFile = path.join(userData, "it-hub.json")
const netLog = path.join(userData, "it-hub-network.log")
const log = (m) => { const line = `${new Date().toISOString()} ${m}`; console.log(line); fs.appendFileSync(netLog, line + "\n") }

const ps = (script) => execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
// Process and connection lists are read as plain lines of numbers and base64, never as JSON: Windows
// PowerShell 5.1's ConvertTo-Json produced unparseable output for some process's command line, and the
// watchdog (failing closed) stopped the hub mid-run. Every line must parse, or the read fails (and is
// retried, then the hub is stopped): a row that cannot be read could hide one of the hub's processes.
const TAB = "[char]9"
const b64 = (expr) => `[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string](${expr})))`
const unb64 = (s) => Buffer.from(s, "base64").toString("utf8")
function readLines(script, fields, what) {
  // a row starts with a number and a tab; anything else PowerShell printed (a warning) is not a row
  const lines = (ps(script) ?? "").split(/\r?\n/).filter((l) => /^\d+\t/.test(l))
  // (the process list is never empty; a hub may have no connections)
  if (!lines.length && what === "process list") throw new Error(`${what}: no rows`)
  return lines.map((line, i) => {
    const parts = line.split("\t")
    if (parts.length !== fields) throw new Error(`${what}: line ${i + 1} has ${parts.length} fields, expected ${fields}`)
    return parts
  })
}
const int = (v, what) => { if (!/^\d+$/.test(v)) throw new Error(`${what}: not a number: ${JSON.stringify(v).slice(0, 40)}`); return Number(v) }
export function processes() {
  return readLines(`Get-CimInstance Win32_Process | ForEach-Object { @([string]$_.ProcessId, [string]$_.ParentProcessId, ${b64("$_.ExecutablePath")}, ${b64("$_.CommandLine")}) -join ${TAB} }`, 4, "process list")
    .map(([pid, ppid, exe, cmd]) => ({ ProcessId: int(pid, "process id"), ParentProcessId: int(ppid, "parent id"), ExecutablePath: unb64(exe), CommandLine: unb64(cmd) }))
}
export function connections(pids) {
  if (!pids.size) return []
  return readLines(`@(Get-NetTCPConnection -ErrorAction SilentlyContinue | Where-Object { @(${[...pids].join(",")}) -contains $_.OwningProcess }) | ForEach-Object { @([string]$_.OwningProcess, [string]$_.RemoteAddress, [string]$_.RemotePort, [string]$_.State) -join ${TAB} }`, 4, "connection list")
    .map(([pid, addr, port, st]) => ({ OwningProcess: int(pid, "owning process"), RemoteAddress: addr, RemotePort: int(port, "remote port"), State: st }))
}
function tree(rootPid) {
  const rows = processes()
  const pids = new Set([rootPid])
  for (let grew = true; grew;) { grew = false; for (const r of rows) if (pids.has(r.ParentProcessId) && !pids.has(r.ProcessId)) { pids.add(r.ProcessId); grew = true } }
  return { pids, rows }
}
function stopHub(state, why) {
  log(`stopping hub (${why})`)
  try { execFileSync("taskkill", ["/PID", String(state.pid), "/T"], { stdio: "ignore" }) } catch { /* already gone */ }
  for (let i = 0; i < 20 && alive(state.pid); i++) execFileSync("powershell.exe", ["-NoProfile", "-Command", "Start-Sleep -Milliseconds 500"])
  if (alive(state.pid)) try { execFileSync("taskkill", ["/PID", String(state.pid), "/T", "/F"], { stdio: "ignore" }) } catch { /* gone */ }
  // orphaned embedded Postgres of this build
  // (ExecutablePath can be empty for these processes; the command line always names the binary)
  const pgDir = path.join(path.dirname(state.exe), "resources", "pg").toLowerCase()
  const norm = (s) => String(s ?? "").replace(/\//g, "\\").toLowerCase()
  let rows = []
  try { rows = tree(-1).rows } catch (e) { log(`could not list processes to find an orphaned embedded postgres: ${String(e?.message ?? e).split("\n")[0]}`) }
  for (const r of rows) if (norm(r.ExecutablePath).startsWith(pgDir) || norm(r.CommandLine).replace(/^"/, "").startsWith(pgDir)) {
    try { execFileSync("taskkill", ["/PID", String(r.ProcessId), "/F"], { stdio: "ignore" }); log(`killed orphaned embedded postgres ${r.ProcessId}`) } catch { /* gone */ }
  }
  log(alive(state.pid) ? "HUB STILL RUNNING after stop" : "hub stopped")
}
function alive(pid) { try { process.kill(pid, 0); return true } catch { return false } }

// selftest: one read of each list, and a process with a hostile command line (quotes, backslashes,
// control characters, Arabic) found intact in it. No hub is started.
if (cmd === "selftest") {
  const hostile = 'x"y\\z\u0001\u001f\u0007 «عربي» \\"end\\'
  const probe = spawn(process.execPath, ["-e", "setTimeout(() => {}, 15000)", hostile], { stdio: "ignore" })
  await new Promise((r) => setTimeout(r, 800))
  try {
    const rows = processes()
    const mine = rows.find((r) => r.ProcessId === probe.pid)
    const own = connections(new Set([process.pid]))
    // Windows passes the argument quoted; what matters is that every row parsed and this one is whole
    const intact = !!mine && mine.CommandLine.includes("«عربي»") && mine.CommandLine.includes("end")
    console.log(JSON.stringify({ processes: rows.length, probeFound: !!mine, probeCommandLineIntact: intact, ownConnections: own.length }))
    process.exitCode = intact ? 0 : 1
  } finally { probe.kill() }
  process.exit(process.exitCode ?? 1)
}

if (cmd === "stop") {
  if (!fs.existsSync(stateFile)) fail("no it-hub.json in that user-data dir (not started by this launcher)")
  stopHub(JSON.parse(fs.readFileSync(stateFile, "utf8")), "stop requested")
  process.exit(0)
}
if (cmd !== "start") fail("usage: start|stop|selftest")

const exe = opt.exe && path.resolve(opt.exe)
if (!exe || !fs.existsSync(exe)) fail("--exe must point at a Titan POS.exe")
let cloud
try { cloud = new URL(opt.cloud) } catch { fail("--cloud is required (a loopback URL, e.g. http://127.0.0.1:3999)") }
if (!["127.0.0.1", "localhost", "[::1]"].includes(cloud.hostname) || cloud.protocol !== "http:") fail(`--cloud must be http on loopback, got ${opt.cloud}`)
const cloudUrl = cloud.origin
fs.mkdirSync(userData, { recursive: true })

const env = { ...process.env, LBPOS_CLOUD_URL: cloudUrl }
const debugPort = opt["debug-port"]
if (debugPort !== undefined && !/^\d{4,5}$/.test(debugPort)) fail("--debug-port must be a port number")
const child = spawn(exe, [
  `--user-data-dir=${userData}`, "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1",
  ...(debugPort ? [`--remote-debugging-port=${debugPort}`, "--remote-debugging-address=127.0.0.1", "--remote-allow-origins=http://127.0.0.1"] : []),
], { env, detached: true, stdio: "ignore" })
child.unref()
const state = { pid: child.pid, exe, cloud: cloudUrl, startedAt: new Date().toISOString() }
fs.writeFileSync(stateFile, JSON.stringify(state, null, 2))
log(`started ${exe} pid ${child.pid}, cloud ${cloudUrl}`)

// .env check: the hub writes it before starting its API
const envFile = path.join(userData, ".env")
let envOk = false
for (let i = 0; i < 60 && !envOk; i++) {
  await new Promise((r) => setTimeout(r, 500))
  // only the copy this launch wrote counts (a leftover .env from an earlier run proves nothing)
  const fresh = fs.existsSync(envFile) && fs.statSync(envFile).mtimeMs >= Date.parse(state.startedAt) - 1000
  const m = fresh ? fs.readFileSync(envFile, "utf8").match(/^CLOUD_API_URL=(.*)$/m) : null
  if (m) { if (m[1].trim().replace(/\/+$/, "") === cloudUrl) envOk = true; else { stopHub(state, `.env names ${new URL(m[1].trim()).host}, not the local cloud`); process.exit(3) } }
}
if (!envOk) { stopHub(state, ".env not written in 30 s"); process.exit(3) }
log(".env cloud URL verified (loopback)")

// outbound watchdog — runs until the hub exits
const loopback = (a) => a === "127.0.0.1" || a === "::1" || a === "0.0.0.0" || a === "::" || a.startsWith("127.")
let violations = 0
while (alive(state.pid)) {
  // Fail closed: if the hub's processes or connections cannot be read, the hub is stopped (a watchdog
  // that dies silently would leave the hub running unwatched).
  let pids, conns
  try {
    for (let attempt = 1; ; attempt++) {
      try {
        pids = tree(state.pid).pids
        conns = connections(pids)
        break
      } catch (e) {
        if (attempt >= 3) throw e
        log(`watchdog read failed (attempt ${attempt} of 3), retrying`)
        await new Promise((r) => setTimeout(r, 300))
      }
    }
  } catch (e) {
    log(`WATCHDOG ERROR: ${String(e?.message ?? e).split("\n")[0]}`)
    stopHub(state, "watchdog could not read the hub's processes or connections")
    process.exit(5)
  }
  const out = (Array.isArray(conns) ? conns : [conns]).filter((c) => c && !loopback(String(c.RemoteAddress)))
  if (out.length) {
    violations++
    log(`OUTBOUND VIOLATION: ${out.map((c) => `pid ${c.OwningProcess} -> ${c.RemoteAddress}:${c.RemotePort} (${c.State})`).join("; ")}`)
    stopHub(state, "non-loopback connection")
    break
  }
  await new Promise((r) => setTimeout(r, 1000))
}
log(`hub exited; outbound violations: ${violations}`)
process.exit(violations ? 4 : 0)
