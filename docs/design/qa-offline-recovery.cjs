// End-to-end offline restart + queued-sale recovery, in the RUNNING desktop app
// against the REAL API on the SCRATCH database (never dev/production data).
//
//   node scratchpad/withdb.mjs scratch.env node docs/design/qa-offline-recovery.cjs
//   (needs the desktop Vite dev server on :5174; starts/stops the API itself on :3099)
//
// 1. API down, browser offline: open a shift, sell 2 × Pepsi in cash → queued.
// 2. Real reload with the store server still unreachable (a till restarted
//    without internet): the sale, its queued operation and the local stock
//    must survive unchanged (no loss, no double decrement, no restore).
// 3. Start the API, press "Sync now": the server must record the sale ONCE.
// 4. Reload again: nothing is sent twice.
// Desktop mode is DIRECT_RAILWAY (offline queueing); hub modes commit
// synchronously by design and refuse an offline sale.
const path = require("path")
const os = require("os")
const fs = require("fs")
const { spawn } = require("child_process")
const { randomUUID } = require("crypto")

const REPO = path.resolve(__dirname, "../..")
const DB = process.env.DATABASE_URL ?? ""
if (!/lebanonpos_refund_it/.test(DB)) { console.error("refusing: DATABASE_URL is not the scratch database"); process.exit(3) }
const req = (mod) => require(path.join(REPO, "apps/electron/node_modules", mod))
const { Client } = req("pg")
const jwt = require(path.join(REPO, "node_modules/.pnpm", fs.readdirSync(path.join(REPO, "node_modules/.pnpm")).find((d) => d.startsWith("jsonwebtoken@")), "node_modules/jsonwebtoken"))

const APP = "http://localhost:5174"
const API_PORT = 3099
const API = `http://127.0.0.1:${API_PORT}`
const SECRET = "offline-recovery-secret"
const TENANT = randomUUID()
const CHROME = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe"
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log(...a)

class CDP {
  constructor(url) { this.ws = new WebSocket(url); this.id = 0; this.pending = new Map() }
  open() { return new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; this.ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && this.pending.has(m.id)) { const { res, rej } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result) } } }) }
  send(method, params = {}, sessionId) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params, sessionId })); return new Promise((res, rej) => this.pending.set(id, { res, rej })) }
}
const H = `window.__t={btn(re){return [...document.querySelectorAll("button")].find(b=>(re.test(b.textContent.trim())||re.test(b.getAttribute("aria-label")||""))&&b.offsetParent!==null&&!b.disabled)},type(el,v){Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(el,v);el.dispatchEvent(new Event("input",{bubbles:true}))}}`

async function db(sql, params = []) { const c = new Client({ connectionString: DB }); await c.connect(); try { return (await c.query(sql, params)).rows } finally { await c.end() } }

function startApi() {
  const env = { ...process.env, PORT: String(API_PORT), BIND_HOST: "127.0.0.1", JWT_SECRET: SECRET, IS_LOCAL_SERVER: "", NODE_ENV: "development" }
  const p = spawn(process.platform === "win32" ? "npx.cmd" : "npx", ["tsx", "src/index.ts"], { cwd: path.join(REPO, "apps/api"), env, shell: process.platform === "win32", stdio: ["ignore", "pipe", "pipe"] })
  p.stdout.on("data", () => {}); p.stderr.on("data", () => {})
  return p
}
async function waitHealth() { for (let i = 0; i < 60; i++) { try { const r = await fetch(`${API}/api/health`); if (r.ok) return true } catch {} await sleep(500) } return false }

;(async () => {
  const results = []
  const check = (name, ok, detail) => { results.push({ name, ok, detail }); log(`${ok ? "PASS" : "FAIL"}  ${name}${detail !== undefined ? `  (${typeof detail === "string" ? detail : JSON.stringify(detail)})` : ""}`) }

  // Disposable tenant on the scratch DB: the dev user exists server-side; Pepsi has the demo barcode.
  await db(`insert into "Tenant"(id,name,subdomain,"updatedAt") values($1,'Offline recovery IT (disposable)',$2,now())`, [TENANT, `or-${TENANT.slice(0, 8)}`])
  await db(`insert into "StaffUser"(id,"tenantId",name,mobile,pin,role,"updatedAt") values('dev-user',$1,'Dev Admin',$2,'x','Admin',now()) on conflict (id) do update set "tenantId"=excluded."tenantId"`, [TENANT, `or-${TENANT.slice(0, 6)}`])
  await db(`insert into "Product"("tenantId",name,price,cost,stock,barcode,category,"updatedAt") values($1,'Pepsi Can',0.9,0.48,50,'528100100002','Drinks',now())`, [TENANT])
  const token = jwt.sign({ userId: "dev-user", tenantId: TENANT, role: "Admin" }, SECRET, { expiresIn: "1h" })

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "offline-qa-"))
  const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--remote-debugging-port=9335", `--user-data-dir=${profile}`,
    "--proxy-server=http://127.0.0.1:9", "--proxy-bypass-list=localhost;127.0.0.1", "--no-first-run", "--disable-extensions", "about:blank"], { stdio: "ignore" })
  let api
  try {
    let ws; for (let i = 0; i < 50 && !ws; i++) { try { ws = (await (await fetch("http://127.0.0.1:9335/json/version")).json()).webSocketDebuggerUrl } catch { await sleep(200) } }
    const cdp = new CDP(ws); await cdp.open()
    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" })
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true })
    const ev = async (js) => { const r = await cdp.send("Runtime.evaluate", { expression: `(async()=>{${H};${js}})()`, awaitPromise: true, returnByValue: true }, sessionId); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value }
    await cdp.send("Page.enable", {}, sessionId)
    await cdp.send("Network.enable", {}, sessionId)
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId)
    const offline = (on) => cdp.send("Network.emulateNetworkConditions", { offline: on, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }, sessionId)

    await cdp.send("Page.navigate", { url: `${APP}/?dev` }, sessionId); await sleep(3000)
    await ev(`localStorage.setItem("lebanonpos.api-url", ${JSON.stringify(API)}); localStorage.setItem("lebanonpos.connection-mode.v1", "DIRECT_RAILWAY"); localStorage.setItem("lebanonpos.auth-token", ${JSON.stringify(token)}); localStorage.setItem("lebanonpos.tenant-id.v1", ${JSON.stringify(TENANT)}); localStorage.setItem("lebanonpos.intro-seen.v1","1")`)
    await cdp.send("Page.navigate", { url: `${APP}/?dev` }, sessionId); await sleep(3500)

    // 1. Offline: shift + cash sale
    await offline(true); await sleep(800)
    check("browser reports offline", (await ev(`return navigator.onLine`)) === false)
    const opened = await ev(`const find=()=>[...document.querySelectorAll("input")].find(i=>/250/.test(i.placeholder||"")&&i.offsetParent!==null); if(!find()){const t=__t.btn(/Cash Drawer|درج النقد/); t&&t.click(); await new Promise(r=>setTimeout(r,500))} const f=find(); if(!f) return "no float field"; __t.type(f,"100"); await new Promise(r=>setTimeout(r,150)); const o=__t.btn(/^(Open|فتح)$/); if(!o) return "no Open button"; o.click(); return "shift opened"`)
    check("shift opened offline", opened === "shift opened", opened); await sleep(900)
    await ev(`const cards=[...document.querySelectorAll("article")].filter(a=>a.offsetParent!==null); const b=cards[1].querySelector("button"); b.click(); b.click()`); await sleep(500)
    await ev(`__t.btn(/^(Exact LBP|بالضبط)/).click()`); await sleep(300)
    await ev(`(__t.btn(/^Pay/)||document.querySelector(".mg2-pay")).click()`); await sleep(700)
    await ev(`__t.btn(/^Confirm/).click()`); await sleep(1200)
    const before = await ev(`const q=JSON.parse(localStorage.getItem("lebanonpos.sync-queue.v1")||"[]"); const sale=q.find(o=>o.entity==="sale"); const p=JSON.parse(localStorage.getItem("lebanonpos.products.v1")||"[]").find(x=>x.id===2); const sales=JSON.parse(localStorage.getItem("lebanonpos.sales.v1")||"[]"); return { opId: sale&&sale.id, saleId: sale&&sale.payload.id, saleNumber: sale&&sale.payload.saleNumber, status: sale&&sale.status, stock: p&&p.stock, localSales: sales.length, queue: q.length }`)
    check("sale completed offline and queued", Boolean(before.opId) && before.localSales === 1, before)

    // 2. Real reload while the store server is unreachable (API not started).
    await offline(false)
    await cdp.send("Page.reload", { ignoreCache: true }, sessionId); await sleep(4500)
    const afterReload = await ev(`const q=JSON.parse(localStorage.getItem("lebanonpos.sync-queue.v1")||"[]"); const sale=q.find(o=>o.entity==="sale"); const p=JSON.parse(localStorage.getItem("lebanonpos.products.v1")||"[]").find(x=>x.id===2); const sales=JSON.parse(localStorage.getItem("lebanonpos.sales.v1")||"[]"); const cap=[...document.querySelectorAll("button[aria-label]")].find(b=>/Sync and status/.test(b.getAttribute("aria-label"))); return { opId: sale&&sale.id, status: sale&&sale.status, attempts: sale&&sale.attempts, stock: p&&p.stock, localSales: sales.length, capsule: cap&&cap.getAttribute("aria-label"), scanFocused: document.activeElement&&/Scan/.test(document.activeElement.getAttribute("aria-label")||"") }`)
    check("after reload: same queued sale operation", afterReload.opId === before.opId && afterReload.status !== "Synced", afterReload)
    check("after reload: sale still in local history, stock unchanged (no double decrement / no restore)", afterReload.localSales === 1 && afterReload.stock === before.stock, { before: before.stock, after: afterReload.stock })
    check("after reload: capsule shows waiting work", /waiting|Offline|need attention/i.test(afterReload.capsule ?? ""), afterReload.capsule)
    check("after reload: scan field has focus", afterReload.scanFocused === true)

    // 3. Store server comes back.
    api = startApi()
    check("API started", await waitHealth())
    await ev(`const c=[...document.querySelectorAll("button[aria-label]")].find(b=>/Sync and status/.test(b.getAttribute("aria-label"))); c.click(); await new Promise(r=>setTimeout(r,400)); const s=__t.btn(/Sync now|زامن الآن|مزامنة الآن/); if(!s) throw new Error("no Sync now"); s.click()`)
    let synced = false
    for (let i = 0; i < 40 && !synced; i++) { await sleep(500); synced = await ev(`const q=JSON.parse(localStorage.getItem("lebanonpos.sync-queue.v1")||"[]"); const s=q.find(o=>o.id===${JSON.stringify(before.opId)}); return !s || s.status==="Synced"`) }
    const server = await db(`select "saleNumber", total::text, status from "Sale" where "tenantId"=$1`, [TENANT])
    const ops = await db(`select count(*)::int as n from "SyncOperation" where "tenantId"=$1 and id=$2`, [TENANT, before.opId])
    const stockSrv = await db(`select stock from "Product" where "tenantId"=$1 and barcode='528100100002'`, [TENANT])
    check("queued sale reached the server exactly once", server.length === 1 && server[0].saleNumber === before.saleNumber && ops[0].n === 1, { server, ops: ops[0].n })
    check("server stock decremented once (50 → 48)", Number(stockSrv[0]?.stock) === 48, stockSrv[0])
    check("local queue marks it Synced", synced)

    // 4. Restart again: nothing sent twice.
    await cdp.send("Page.reload", { ignoreCache: true }, sessionId); await sleep(6000)
    const again = await db(`select count(*)::int as n from "Sale" where "tenantId"=$1`, [TENANT])
    const stockAgain = await db(`select stock from "Product" where "tenantId"=$1 and barcode='528100100002'`, [TENANT])
    check("after a second restart: still one sale, stock still 48", again[0].n === 1 && Number(stockAgain[0]?.stock) === 48, { sales: again[0].n, stock: stockAgain[0]?.stock })
    const shot = await cdp.send("Page.captureScreenshot", { format: "png" }, sessionId)
    fs.mkdirSync(path.join(__dirname, "qa/app-after"), { recursive: true })
    fs.writeFileSync(path.join(__dirname, "qa/app-after/offline-recovery.en.dark.desktop.png"), Buffer.from(shot.data, "base64"))
    fs.writeFileSync(path.join(__dirname, "qa/offline-recovery.json"), JSON.stringify({ at: new Date().toISOString(), results }, null, 2))
  } catch (e) {
    results.push({ name: "run", ok: false, detail: String(e && e.message || e) }); log("ERROR", e && e.message || e)
  } finally {
    if (api) { try { process.platform === "win32" ? spawn("taskkill", ["/pid", String(api.pid), "/T", "/F"]) : api.kill() } catch {} }
    chrome.kill()
    for (const t of ["StockMovement", "SyncOperation", "SaleTender", "Shift", "AuditEvent", "CashMovement"]) await db(`delete from "${t}" where "tenantId"=$1`, [TENANT]).catch(() => {})
    await db(`delete from "SaleItem" where "saleId" in (select id from "Sale" where "tenantId"=$1)`, [TENANT]).catch(() => {})
    await db(`delete from "Sale" where "tenantId"=$1`, [TENANT]).catch(() => {})
    await db(`delete from "Shift" where "tenantId"=$1`, [TENANT]).catch(() => {})
    await db(`delete from "Product" where "tenantId"=$1`, [TENANT]).catch(() => {})
    await db(`delete from "StaffUser" where "tenantId"=$1`, [TENANT]).catch(() => {})
    await db(`delete from "Tenant" where id=$1`, [TENANT]).catch(() => {})
    const failed = results.filter((r) => !r.ok).length
    log(`\n${results.length - failed}/${results.length} checks passed`)
    process.exit(failed ? 1 : 0)
  }
})().catch((e) => { console.error(e); process.exit(1) })
