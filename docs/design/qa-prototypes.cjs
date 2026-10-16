// Renders every prototype × language × theme × viewport in headless Chrome with
// the NETWORK BLOCKED (proxy to a dead port + no DNS) and EXACT device metrics
// (Chrome DevTools Protocol Emulation.setDeviceMetricsOverride — a plain
// --window-size cannot go below Chrome's ~500px minimum, which silently laid
// "phone" renders out at 500px). Screenshots each and collects each page's
// ?qa=1 self-check report (overflow, broken images, fonts actually loaded,
// unlabelled controls, rendered text contrast).
//
//   node docs/design/qa-prototypes.cjs [chromePath]
//
// Output: docs/design/qa/shots/*.png (git-ignored), docs/design/qa/report.json,
// docs/design/qa/index.html (contact sheet + findings).
const fs = require("fs")
const path = require("path")
const os = require("os")
const { spawn } = require("child_process")
const { pathToFileURL } = require("url")

const CHROME = process.argv[2] || "C:/Program Files/Google/Chrome/Application/chrome.exe"
const PROTO = path.join(__dirname, "prototypes")
const QA = path.join(__dirname, "qa")
const SHOTS = path.join(QA, "shots")
fs.mkdirSync(SHOTS, { recursive: true })

const screens = fs.readdirSync(PROTO).filter((f) => f.endsWith(".html") && !f.includes(".ar.")).map((f) => f.replace(/\.html$/, "")).sort()
const VIEWPORTS = { desktop: [1440, 900, false], tablet: [1024, 768, true], mobile: [390, 844, true] }
const jobs = []
for (const screen of screens) for (const lang of ["en", "ar"]) for (const theme of ["dark", "light"]) for (const [vp, [w, h, mobile]] of Object.entries(VIEWPORTS)) {
  jobs.push({ screen, lang, theme, vp, w, h, mobile })
}

const PORT = 9333
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "proto-qa-"))
const chrome = spawn(CHROME, [
  "--headless=new", "--disable-gpu", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  "--proxy-server=http://127.0.0.1:9", "--proxy-bypass-list=<-loopback>", "--host-resolver-rules=MAP * ~NOTFOUND",
  "--disable-background-networking", "--no-first-run", "--no-default-browser-check", "--disable-extensions",
  "--allow-file-access-from-files", "--hide-scrollbars", "about:blank",
], { stdio: "ignore" })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function browserWs() {
  for (let i = 0; i < 50; i++) {
    try { return (await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()).webSocketDebuggerUrl } catch { await sleep(200) }
  }
  throw new Error("Chrome DevTools endpoint did not come up")
}

class CDP {
  constructor(url) { this.ws = new WebSocket(url); this.id = 0; this.pending = new Map(); this.waiters = [] }
  open() { return new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; this.ws.onmessage = (e) => this.onMessage(JSON.parse(e.data)) }) }
  onMessage(m) {
    if (m.id && this.pending.has(m.id)) { const { res, rej } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result) }
    else if (m.method) this.waiters = this.waiters.filter((w) => !(w.match(m) && (w.res(m.params), true)))
  }
  send(method, params = {}, sessionId) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params, sessionId })); return new Promise((res, rej) => this.pending.set(id, { res, rej })) }
  once(method, sessionId, timeout = 20000) {
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error(`timeout waiting for ${method}`)), timeout)
      this.waiters.push({ match: (m) => m.method === method && m.sessionId === sessionId, res: (p) => { clearTimeout(t); res(p) } })
    })
  }
}

async function run(cdp, job) {
  const file = path.join(PROTO, `${job.screen}${job.lang === "ar" ? ".ar" : ""}.html`)
  const id = `${job.screen}.${job.lang}.${job.theme}.${job.vp}`
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" })
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true })
  try {
    await cdp.send("Page.enable", {}, sessionId)
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: job.w, height: job.h, deviceScaleFactor: 1, mobile: job.mobile }, sessionId)
    const loaded = cdp.once("Page.loadEventFired", sessionId)
    await cdp.send("Page.navigate", { url: `${pathToFileURL(file).href}?theme=${job.theme}&qa=1` }, sessionId)
    await loaded
    const { result } = await cdp.send("Runtime.evaluate", {
      expression: `new Promise(r=>{let n=0;const t=setInterval(()=>{const el=document.getElementById('qa-report');if(el||++n>100){clearInterval(t);r(el?el.textContent:null)}},50)})`,
      awaitPromise: true, returnByValue: true,
    }, sessionId)
    // Remove the report node so it is not in the screenshot.
    await cdp.send("Runtime.evaluate", { expression: "document.getElementById('qa-report')?.remove()" }, sessionId)
    const shot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }, sessionId)
    const shotPath = path.join(SHOTS, `${id}.png`)
    fs.writeFileSync(shotPath, Buffer.from(shot.data, "base64"))
    return { id, ...job, shot: path.relative(QA, shotPath).replace(/\\/g, "/"), shotOk: true, qa: result.value ? JSON.parse(result.value) : null }
  } finally {
    await cdp.send("Target.closeTarget", { targetId }).catch(() => {})
  }
}

const issues = (r) => {
  const q = r.qa
  if (!q) return ["no QA report"]
  const out = []
  if (q.viewport !== `${r.w}x${r.h}`) out.push(`viewport ${q.viewport} ≠ ${r.w}x${r.h}`)
  if (q.overflowX) out.push(`horizontal overflow (${q.overflowX}px wide)`)
  if (q.brokenImages) out.push(`${q.brokenImages} broken image(s)`)
  if (!q.fontLatin) out.push("Inter not loaded")
  if (r.lang === "ar" && !q.fontArabic) out.push("Arabic font not loaded")
  if (q.lowContrastCount) out.push(`${q.lowContrastCount} low-contrast text node(s)`)
  if (q.unnamedControls?.length) out.push(`${q.unnamedControls.length} unnamed control(s)`)
  if (r.lang === "ar" && q.dir !== "rtl") out.push("not RTL")
  return out
}

;(async () => {
  const cdp = new CDP(await browserWs())
  await cdp.open()
  const results = []
  const queue = jobs.slice()
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (queue.length) {
      const job = queue.shift()
      try { results.push(await run(cdp, job)) } catch (e) { results.push({ id: `${job.screen}.${job.lang}.${job.theme}.${job.vp}`, ...job, shotOk: false, qa: null, error: e.message }) }
      if (results.length % 18 === 0) console.log(`${results.length}/${jobs.length}`)
    }
  }))
  chrome.kill()
  results.sort((a, b) => a.id.localeCompare(b.id))
  const summary = {
    generatedAt: new Date().toISOString(), network: "blocked (proxy 127.0.0.1:9 + DNS ~NOTFOUND)", emulation: "CDP setDeviceMetricsOverride (exact sizes)",
    renders: results.length, screenshots: results.filter((r) => r.shotOk).length, withQa: results.filter((r) => r.qa).length,
    exactViewport: results.filter((r) => r.qa?.viewport === `${r.w}x${r.h}`).length, clean: results.filter((r) => issues(r).length === 0).length,
  }
  fs.writeFileSync(path.join(QA, "report.json"), JSON.stringify({ summary, results: results.map((r) => ({ ...r, issues: issues(r) })) }, null, 2))
  const rows = results.map((r) => `<figure><a href="${r.shot}"><img loading="lazy" src="${r.shot}" alt="${r.id}"></a><figcaption><b>${r.screen}</b> · ${r.lang} · ${r.theme} · ${r.vp} (${r.w}×${r.h})<br>${issues(r).length ? `<span class="bad">${issues(r).join(" · ")}</span>` : `<span class="ok">clean · ${r.qa.icons} icons · ${r.qa.textNodesChecked} text nodes checked</span>`}</figcaption></figure>`).join("\n")
  fs.writeFileSync(path.join(QA, "index.html"), `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Prototype QA</title><style>body{font-family:system-ui;background:#0B0E14;color:#F4F6FA;margin:24px}h1{font-size:20px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px}figure{margin:0;background:#12161F;border:1px solid #1E2430;border-radius:10px;padding:8px}img{width:100%;height:220px;object-fit:cover;object-position:top;border-radius:6px;background:#000}figcaption{font-size:12px;margin-top:6px;color:#9AA4B8}.ok{color:#34D399}.bad{color:#F87171}</style></head><body><h1>Prototype QA — ${summary.renders} renders, network blocked, exact viewports</h1><p>${summary.clean}/${summary.renders} clean · ${summary.exactViewport} exact viewports · ${summary.withQa} QA reports · ${summary.generatedAt}</p><div class="grid">${rows}</div></body></html>`)
  console.log(JSON.stringify(summary))
  process.exit(0)
})().catch((e) => { console.error(e); chrome.kill(); process.exit(1) })
