// Captures the RUNNING desktop app (Vite dev server, local dev mode, no API)
// through the register flow, for before/after visual review:
//   shell + register (cart, cash tender) → payment review → sale complete,
//   and Simple POS — at desktop and phone sizes, dark/light, EN/AR.
//
//   node docs/design/qa-app.cjs <outDir> [baseUrl=http://localhost:5174]
//
// Network: only loopback is reachable (every other host fails), so nothing
// leaves the machine. Data: a fresh browser profile per scene in local dev
// mode (?dev → "Dev Admin", bundled demo catalog); a shift is opened with a
// $100 float through the app's own Cash Drawer form. No API, no real data.
const fs = require("fs")
const path = require("path")
const os = require("os")
const { spawn } = require("child_process")

const OUT = path.resolve(process.argv[2] ?? "docs/design/qa/app")
const BASE = process.argv[3] ?? "http://localhost:5174"
const CHROME = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe"
fs.mkdirSync(OUT, { recursive: true })
const PORT = 9334
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

class CDP {
  constructor(url) { this.ws = new WebSocket(url); this.id = 0; this.pending = new Map(); this.waiters = [] }
  open() { return new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; this.ws.onmessage = (e) => this.onMessage(JSON.parse(e.data)) }) }
  onMessage(m) {
    if (m.id && this.pending.has(m.id)) { const { res, rej } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result) }
    else if (m.method) this.waiters = this.waiters.filter((w) => !(w.match(m) && (w.res(m.params), true)))
  }
  send(method, params = {}, sessionId) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params, sessionId })); return new Promise((res, rej) => this.pending.set(id, { res, rej })) }
}

// In-page helpers, injected before every step.
const HELPERS = `
window.__t = {
  byText(sel, re) { return [...document.querySelectorAll(sel)].find((el) => re.test((el.getAttribute("aria-label") || "") + " " + el.textContent) && el.offsetParent !== null) },
  textBtn(re) { return [...document.querySelectorAll("button")].find((el) => re.test(el.textContent.trim()) && el.offsetParent !== null && !el.disabled) },
  click(sel, re) { const el = this.byText(sel, re); if (!el) throw new Error("not found: " + sel + " " + re); el.click(); return true },
  type(el, value) { const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })) },
  key(el, key) { el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })); el.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true })) },
}`

async function scene(cdp, name, { w, h, mobile = false, theme = "dark", lang = "en", steps, setup = "" }) {
  const { browserContextId } = await cdp.send("Target.createBrowserContext")
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank", browserContextId })
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true })
  const ev = async (expression) => {
    const r = await cdp.send("Runtime.evaluate", { expression: `(async()=>{${HELPERS};${expression}})()`, awaitPromise: true, returnByValue: true }, sessionId)
    if (r.exceptionDetails) throw new Error(`${name}: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`)
    return r.result.value
  }
  try {
    await cdp.send("Page.enable", {}, sessionId)
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile }, sessionId)
    await cdp.send("Page.navigate", { url: `${BASE}/?dev` }, sessionId)
    await sleep(2500)
    await ev(`localStorage.setItem("lebanonpos.theme", ${JSON.stringify(theme)}); localStorage.setItem("lebanonpos.locale", ${JSON.stringify(lang)}); localStorage.setItem("lebanonpos.locale.v1", ${JSON.stringify(lang)}); localStorage.setItem("lebanonpos.intro-seen.v1","1");${setup}`)
    await cdp.send("Page.navigate", { url: `${BASE}/?dev` }, sessionId)
    await sleep(3000)
    const log = []
    for (const [label, js, wait = 600] of steps) {
      if (typeof js === "string" && js.startsWith("@key:")) {
        // Real key presses (CDP) so the browser moves focus itself.
        const [, key, times = "1", shift] = js.split(":")
        const codes = { Tab: 9, Escape: 27, Enter: 13 }
        for (let i = 0; i < Number(times); i++) {
          for (const type of ["rawKeyDown", "keyUp"]) await cdp.send("Input.dispatchKeyEvent", { type, key, code: key, windowsVirtualKeyCode: codes[key], modifiers: shift ? 8 : 0 }, sessionId)
          await sleep(80)
        }
        log.push([label, await ev(`const d=document.querySelector("[role=dialog][aria-modal=true]"); const a=document.activeElement; return (d ? (d.contains(a) ? "inside dialog: " : "OUTSIDE dialog: ") : "no dialog, ") + (a ? (a.getAttribute("aria-label") || a.textContent.trim().slice(0,30) || a.tagName) : "none")`)])
        await sleep(wait); continue
      }
      if (typeof js === "string" && js.startsWith("@resize:")) {
        const [, rw, rh] = js.split(":")
        await cdp.send("Emulation.setDeviceMetricsOverride", { width: Number(rw), height: Number(rh), deviceScaleFactor: 1, mobile: Number(rw) < 768 }, sessionId)
        log.push([label, `viewport ${rw}x${rh}`]); await sleep(wait); continue
      }
      if (js === "@offline") {
        await cdp.send("Network.enable", {}, sessionId)
        await cdp.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }, sessionId)
        log.push([label, "network offline"]); await sleep(wait); continue
      }
      try { log.push([label, await ev(js)]) } catch (e) { log.push([label, "ERROR " + e.message]) }
      await sleep(wait)
    }
    const shot = await cdp.send("Page.captureScreenshot", { format: "png" }, sessionId)
    fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(shot.data, "base64"))
    const facts = await ev(`return { dir: document.documentElement.dir, theme: document.documentElement.dataset.theme, active: (document.activeElement && (document.activeElement.getAttribute("aria-label") || document.activeElement.placeholder || document.activeElement.tagName)) || null, overflowX: document.documentElement.scrollWidth > innerWidth + 1 }`)
    return { name, w, h, theme, lang, log, facts }
  } finally {
    await cdp.send("Target.closeTarget", { targetId }).catch(() => {})
    await cdp.send("Target.disposeBrowserContext", { browserContextId }).catch(() => {})
  }
}

// Shared steps (labels/aria are the app's own, stable across the re-skin).
const openShift = ["open shift", `
  const float = [...document.querySelectorAll("input")].find((i) => /float|250/i.test((i.placeholder||"") + (i.getAttribute("aria-label")||"") + (i.closest("label")?.textContent||"")))
  if (!float) {
    const toggle = __t.byText("button", /Cash Drawer|درج النقد|الصندوق النقدي/i)
    if (toggle) toggle.click()
    await new Promise(r=>setTimeout(r,500))
  }
  const f2 = [...document.querySelectorAll("input")].find((i) => /float|250/i.test((i.placeholder||"") + (i.getAttribute("aria-label")||"") + (i.closest("label")?.textContent||"")))
  if (!f2) return "no float field (shift may already be open)"
  __t.type(f2, "100"); await new Promise(r=>setTimeout(r,150))
  const openBtn = __t.textBtn(/^(Open|فتح|فتح الوردية)$/i); if (!openBtn) throw new Error("no Open button"); openBtn.click(); await new Promise(r=>setTimeout(r,300)); return "shift opened"`, 900]
const scan = (q) => [`scan ${q}`, `
  const input = document.querySelector("input[aria-label*='Scan' i], input[placeholder*='Scan' i], input[placeholder*='امسح']")
  if (!input) throw new Error("no scan input")
  input.focus(); __t.type(input, ${JSON.stringify(q)}); await new Promise(r=>setTimeout(r,150)); __t.key(input, "Enter"); return document.activeElement === input ? "focus kept on scan" : "focus moved to " + (document.activeElement?.getAttribute("aria-label") || document.activeElement?.tagName)`, 500]
const addTiles = ["add 3 products", `
  const cards = [...document.querySelectorAll("[data-product-tile], article")].filter((a) => a.offsetParent !== null)
  const tiles = cards.map((a) => (a.matches("button") ? a : a.querySelector("button"))).filter(Boolean)
  tiles[0].click(); tiles[1].click(); tiles[1].click(); tiles[4].click(); return tiles.length + " products"`, 700]
const cashPaid = ["cash tender $20 + 200,000 LBP", `
  const inputs = [...document.querySelectorAll("input")].filter((i) => i.offsetParent !== null)
  const usd = inputs.find((i) => /usd|\\$|dollar|دولار/i.test((i.getAttribute("aria-label")||"") + (i.placeholder||"") + (i.closest("label")?.textContent||"")) && !/scan/i.test(i.placeholder||""))
  const lbp = inputs.find((i) => /lbp|ل\\.ل|ليرة/i.test((i.getAttribute("aria-label")||"") + (i.placeholder||"") + (i.closest("label")?.textContent||"")) && i !== usd)
  if (usd) __t.type(usd, "20"); if (lbp) __t.type(lbp, "200000"); return (usd ? "usd " : "") + (lbp ? "lbp" : "")`, 600]
const review = ["open payment review", `
  const btn = __t.textBtn(/^(Pay|ادفع|الدفع)/i) || document.querySelector(".btn-checkout")
  if (!btn) throw new Error("no pay button"); btn.click(); return btn.textContent.trim().slice(0, 60)`, 800]
const confirm = ["confirm payment", `
  const btn = __t.textBtn(/^(Confirm|تأكيد)/i)
  if (!btn) throw new Error("no confirm"); btn.click(); return btn.textContent.trim().slice(0, 60)`, 900]
const quick = ["enter Simple POS", `
  const btn = __t.byText("button", /(Quick POS|Simple|الوضع المبسط|سريع)/i); if (!btn) throw new Error("no simple mode button"); btn.click(); return "ok"`, 900]

const focusName = "(document.activeElement && (document.activeElement.getAttribute(\"aria-label\") || document.activeElement.placeholder || document.activeElement.tagName))"
const keyOnFocus = (key) => [`press ${key}`, `const el = document.activeElement || document.body; __t.key(el, ${JSON.stringify(key)}); await new Promise(r=>setTimeout(r,250)); return "focus: " + ${focusName}`, 300]
const tenderChecked = ["tender selected", `const r = [...document.querySelectorAll("input[type=radio][name^=tender]")].find((i) => i.checked); return r ? r.value : "none"`, 100]
const focusScan = ["focus scan", `const i = document.querySelector("input[aria-label*=Scan i]"); i.focus(); return ${focusName}`, 150]
const dialogState = ["dialog open?", `return document.querySelector("[role=dialog][aria-modal=true]") ? "review dialog open" : "no dialog"`, 100]
const capsule = ["status capsule", `const b = [...document.querySelectorAll("button[aria-label]")].find((x) => /Sync and status|المزامنة والحالة/.test(x.getAttribute("aria-label"))); return b ? b.getAttribute("aria-label") : "no capsule"`, 100]
const queued = ["sync queue", `const q = JSON.parse(localStorage.getItem("lebanonpos.sync-queue.v1") || "[]"); return q.filter((o) => o.entity === "sale").map((o) => o.status + " " + (o.payload && o.payload.saleNumber)).join(", ") || "no sale ops"`, 100]
const exactCash = ["exact LBP", `__t.textBtn(/^(Exact LBP|المبلغ بالليرة|بالضبط)/i).click(); return "ok"`, 400]
const permState = ["permission state", `
  const sac = __t.textBtn(/Sell at Cost|البيع بسعر الكلفة/i); const disc = __t.textBtn(/^(Discount|الخصم)/i); if (disc) disc.click(); await new Promise(r=>setTimeout(r,250))
  return "sell-at-cost " + (sac ? "SHOWN" : "hidden") + "; discount: " + ((document.body.innerText.match(/permission required|تتطلب صلاحية|يتطلب صلاحية|Permission required/i) || ["no permission note"])[0])`, 200]
const asCashier = `(()=>{ const u = JSON.parse(localStorage.getItem("lebanonpos.users.v1") || "[]"); if (u[0]) { u[0].role = "Cashier"; u[0].permissions = []; localStorage.setItem("lebanonpos.users.v1", JSON.stringify(u)) } })()`

const trapSteps = [["Tab ×7", "@key:Tab:7", 150], ["Shift+Tab ×5", "@key:Tab:5:shift", 150], ["Esc (real key)", "@key:Escape:1", 400]]
const BEHAVIOUR = [
  ["behaviour-focus-trap.en.dark.desktop", { w: 1440, h: 900, steps: [openShift, addTiles, exactCash, review, ...trapSteps] }],
  ["behaviour-focus-trap-simple.en.dark.desktop", { w: 1440, h: 900, steps: [openShift, addTiles, quick, exactCash, review, ...trapSteps] }],
  ["behaviour-keys.en.dark.desktop", { w: 1440, h: 900, steps: [openShift, addTiles, focusScan, keyOnFocus("F3"), tenderChecked, keyOnFocus("F2"), tenderChecked, exactCash, focusScan, keyOnFocus("Enter"), dialogState, keyOnFocus("Escape"), dialogState, ["focus after Esc", `return ${focusName}`, 100], keyOnFocus("Escape"), ["focus after Esc in scan field", `return ${focusName}`, 100]] }],
  ["behaviour-offline.en.dark.desktop", { w: 1440, h: 900, steps: [openShift, ["go offline", "@offline", 800], capsule, addTiles, exactCash, review, confirm, queued, capsule, ["focus after sale", `return ${focusName}`, 100]] }],
  ["behaviour-cashier.en.dark.desktop", { w: 1440, h: 900, setup: asCashier, steps: [openShift, addTiles, permState] }],
  ["behaviour-cashier-simple.en.dark.desktop", { w: 1440, h: 900, setup: asCashier, steps: [openShift, addTiles, quick, ["sell-at-cost in Simple POS", `return __t.textBtn(/Sell at Cost/i) ? "SHOWN" : "hidden"`, 100]] }],
]

const toPhone = ["switch to phone", "@resize:390:844", 900]
const openCartSheet = ["open cart sheet", `const b = [...document.querySelectorAll(".mg2-paybar button")][0]; if (!b) throw new Error("no paybar"); b.click(); return "ok"`, 700]
const payInSheet = ["pay (cart sheet)", `const p = [...document.querySelectorAll(".mg2-pay")].filter((x) => x.offsetParent !== null && !x.closest(".mg2-paybar")).pop(); if (!p) throw new Error("no pay in sheet"); p.click(); return p.textContent.trim().slice(0, 60)`, 800]
const MORE = [
  ["payment-review.ar.light.desktop", { w: 1440, h: 900, theme: "light", lang: "ar", steps: [openShift, addTiles, cashPaid, review] }],
  ["sale-complete.ar.dark.desktop", { w: 1440, h: 900, lang: "ar", steps: [openShift, addTiles, cashPaid, review, confirm] }],
  ["sale-complete.en.light.desktop", { w: 1440, h: 900, theme: "light", steps: [openShift, addTiles, exactCash, review, confirm] }],
  ["simple-pos.en.light.desktop", { w: 1440, h: 900, theme: "light", steps: [openShift, addTiles, quick, exactCash] }],
  ["register.ar.light.mobile", { w: 1440, h: 900, theme: "light", lang: "ar", steps: [openShift, toPhone, addTiles] }],
  ["cart-sheet.en.dark.mobile", { w: 1440, h: 900, steps: [openShift, toPhone, addTiles, openCartSheet, exactCash] }],
  ["payment-review.en.dark.mobile", { w: 1440, h: 900, steps: [openShift, toPhone, addTiles, openCartSheet, exactCash, payInSheet] }],
  ["sale-complete.en.dark.mobile", { w: 1440, h: 900, steps: [openShift, toPhone, addTiles, openCartSheet, exactCash, payInSheet, confirm] }],
  ["payment-review.ar.light.mobile", { w: 1440, h: 900, theme: "light", lang: "ar", steps: [openShift, toPhone, addTiles, openCartSheet, exactCash, payInSheet] }],
  ["simple-pos.en.dark.mobile", { w: 1440, h: 900, steps: [openShift, toPhone, addTiles, quick, exactCash] }],
]

// Fresh session at phone/tablet size from the first paint: no @resize, no seeded shift.
const shiftChip = `[...document.querySelectorAll("header button[aria-label]")].find((b) => /Open shift|Shift & drawer|فتح وردية|الوردية والدرج/.test(b.getAttribute("aria-label")))`
const shiftState = ["state", `
  const chip = ${shiftChip}
  const banner = [...document.querySelectorAll(".mg2-banner")].find((b) => b.offsetParent !== null && /No open shift|لا وردية مفتوحة/.test(b.textContent))
  return "chip: " + (chip ? chip.getAttribute("aria-label") + " (" + Math.round(chip.getBoundingClientRect().height) + "px)" : "MISSING") + "; banner: " + (banner ? "shown" : "none") + "; viewport " + innerWidth + "x" + innerHeight`, 100]
const openSheetFromChip = ["tap topbar shift chip", `
  const chip = ${shiftChip}
  if (!chip) throw new Error("no shift chip"); chip.focus(); chip.click(); await new Promise(r=>setTimeout(r,400))
  const d = document.querySelector("[role=dialog][aria-labelledby=shift-sheet-title]")
  return d ? "sheet open; focus " + (d.contains(document.activeElement) ? "inside: " + (document.activeElement.getAttribute("aria-label") || document.activeElement.placeholder || document.activeElement.textContent.trim().slice(0,30)) : "OUTSIDE") : "NO SHEET"`, 300]
const openSheetFromBanner = ["tap banner Open shift", `
  const b = [...document.querySelectorAll(".mg2-banner button")].find((x) => x.offsetParent !== null); if (!b) throw new Error("no banner button"); b.click(); await new Promise(r=>setTimeout(r,400))
  return document.querySelector("[aria-labelledby=shift-sheet-title]") ? "sheet open" : "NO SHEET"`, 300]
const sheetFacts = ["sheet contents", `
  const d = document.querySelector("[aria-labelledby=shift-sheet-title]"); if (!d) return "no sheet"
  const r = d.getBoundingClientRect()
  const small = [...d.querySelectorAll("button:not([disabled]), input, select")].filter((e) => e.offsetParent !== null && e.getBoundingClientRect().height < 44).map((e) => (e.getAttribute("aria-label") || e.textContent.trim().slice(0,20) || e.tagName) + " " + Math.round(e.getBoundingClientRect().height))
  const why = [...d.querySelectorAll("p")].map((p) => p.textContent.trim()).filter((x) => /permission|صلاحية|opened this shift|فتحها|Open a shift first|افتح وردية/i.test(x))
  const disabled = [...d.querySelectorAll("button[disabled]")].map((b) => b.textContent.trim().slice(0,20))
  return "sheet " + Math.round(r.width) + "x" + Math.round(r.height) + " fits=" + (r.bottom <= innerHeight + 1 && r.right <= innerWidth + 1) + "; under-44px: " + (small.join(", ") || "none") + "; disabled: " + (disabled.join(", ") || "none") + "; reasons: " + (why.join(" | ") || "none")`, 100]
const openExpense = ["expand Record expense", `__t.click("[aria-labelledby=shift-sheet-title] button", /Record expense|تسجيل مصروف/i); return "ok"`, 400]
const escSheet = ["Esc (real key)", "@key:Escape:1", 400]
const afterClose = ["after close", `return (document.querySelector("[aria-labelledby=shift-sheet-title]") ? "sheet STILL open" : "sheet closed") + "; focus: " + (document.activeElement?.getAttribute("aria-label") || document.activeElement?.tagName)`, 100]
const expectedCash = ["drawer after sale", `const d = document.querySelector("[aria-labelledby=shift-sheet-title]"); return d ? d.innerText.replace(/\\s+/g, " ").slice(0, 220) : "no sheet"`, 100]
const freshShift = [shiftState, openSheetFromChip, sheetFacts, openShift, shiftState, escSheet, afterClose]
const SHIFT = [
  ["shift-fresh.en.dark.mobile", { w: 390, h: 844, mobile: true, steps: [...freshShift, addTiles, openCartSheet, exactCash, payInSheet, confirm, openSheetFromChip, expectedCash, sheetFacts] }],
  ["shift-fresh.ar.light.mobile", { w: 390, h: 844, mobile: true, theme: "light", lang: "ar", steps: [shiftState, openSheetFromBanner, sheetFacts, openShift, shiftState, escSheet, afterClose] }],
  ["shift-fresh.en.dark.tablet", { w: 768, h: 1024, mobile: true, steps: [...freshShift, addTiles, openCartSheet, exactCash, payInSheet, confirm, shiftState] }],
  ["shift-cashier.en.dark.mobile", { w: 390, h: 844, mobile: true, setup: asCashier, steps: [shiftState, openSheetFromChip, openShift, sheetFacts, openExpense, sheetFacts] }],
  ["shift-sheet-open.en.dark.mobile", { w: 390, h: 844, mobile: true, steps: [shiftState, openSheetFromChip] }],
  ["shift-sheet-cashier.ar.dark.mobile", { w: 390, h: 844, mobile: true, lang: "ar", setup: asCashier, steps: [openSheetFromChip, openShift, openExpense] }],
]

const SCENES = [
  ["register-cash.en.dark.desktop", { w: 1440, h: 900, steps: [openShift, addTiles, cashPaid] }],
  ["register-cash.en.light.desktop", { w: 1440, h: 900, theme: "light", steps: [openShift, addTiles, cashPaid] }],
  ["register-cash.ar.dark.desktop", { w: 1440, h: 900, lang: "ar", steps: [openShift, addTiles, cashPaid] }],
  ["register-scan-focus.en.dark.desktop", { w: 1440, h: 900, steps: [openShift, scan("pepsi")] }],
  ["payment-review.en.dark.desktop", { w: 1440, h: 900, steps: [openShift, addTiles, cashPaid, review] }],
  ["sale-complete.en.dark.desktop", { w: 1440, h: 900, steps: [openShift, addTiles, cashPaid, review, confirm] }],
  ["simple-pos.en.dark.desktop", { w: 1440, h: 900, steps: [openShift, addTiles, quick] }],
  ["register.en.dark.mobile", { w: 390, h: 844, mobile: true, steps: [openShift, addTiles] }],
  ["simple-pos.ar.light.mobile", { w: 390, h: 844, mobile: true, theme: "light", lang: "ar", steps: [openShift, addTiles, quick] }],
]

;(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "app-qa-"))
  const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    "--proxy-server=http://127.0.0.1:9", "--proxy-bypass-list=localhost;127.0.0.1", "--no-first-run", "--disable-extensions", "--hide-scrollbars", "about:blank"], { stdio: "ignore" })
  try {
    let ws
    for (let i = 0; i < 50 && !ws; i++) { try { ws = (await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()).webSocketDebuggerUrl } catch { await sleep(200) } }
    const cdp = new CDP(ws); await cdp.open()
    const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null
    const results = []
    for (const [name, opts] of (process.env.SHIFT ? SHIFT : process.env.BEHAVIOUR ? BEHAVIOUR : process.env.MORE ? MORE : [...SCENES, ...MORE, ...SHIFT])) if (!only || only.test(name)) { results.push(await scene(cdp, name, opts)); console.log(name, JSON.stringify(results.at(-1).log.map(([l, v]) => `${l}: ${v}`)), JSON.stringify(results.at(-1).facts)) }
    fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify({ base: BASE, at: new Date().toISOString(), results }, null, 2))
  } finally { chrome.kill() }
})().catch((e) => { console.error(e); process.exit(1) })
