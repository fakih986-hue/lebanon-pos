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

async function scene(cdp, name, { w, h, mobile = false, theme = "dark", lang = "en", steps, setup = "", path: route = "/" }) {
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
    await cdp.send("Page.navigate", { url: `${BASE}${route}?dev` }, sessionId)
    await sleep(3000)
    const log = []
    for (const [label, js, wait = 600] of steps) {
      if (typeof js === "string" && js.startsWith("@key:")) {
        // Real key presses (CDP) so the browser moves focus itself.
        const [, key, times = "1", shift] = js.split(":")
        const codes = { Tab: 9, Escape: 27, Enter: 13 }
        for (let i = 0; i < Number(times); i++) {
          // Enter carries its text so the browser performs the default action (e.g. activating a focused button), as a real keyboard does.
          for (const type of [key === "Enter" ? "keyDown" : "rawKeyDown", "keyUp"]) await cdp.send("Input.dispatchKeyEvent", { type, key, code: key, windowsVirtualKeyCode: codes[key], modifiers: shift ? 8 : 0, ...(key === "Enter" && type === "keyDown" ? { text: "\r", unmodifiedText: "\r" } : {}) }, sessionId)
          await sleep(80)
        }
        log.push([label, await ev(`const d=[...document.querySelectorAll("[role=dialog][aria-modal=true]")].filter((x) => !x.closest("[inert]")).pop(); const a=document.activeElement; return (d ? (d.contains(a) ? "inside dialog: " : "OUTSIDE dialog: ") : "no dialog, ") + (a ? (a.getAttribute("aria-label") || a.textContent.trim().slice(0,30) || a.tagName) : "none")`)])
        await sleep(wait); continue
      }
      if (typeof js === "string" && js.startsWith("@resize:")) {
        const [, rw, rh] = js.split(":")
        await cdp.send("Emulation.setDeviceMetricsOverride", { width: Number(rw), height: Number(rh), deviceScaleFactor: 1, mobile: Number(rw) < 768 }, sessionId)
        log.push([label, `viewport ${rw}x${rh}`]); await sleep(wait); continue
      }
      if (typeof js === "string" && /^@(dbltap|dblclick):/.test(js)) {
        const kind = js.slice(1, js.indexOf(":")); const sel = js.slice(js.indexOf(":") + 1)
        const pt = await ev(`const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.offsetParent !== null); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }`)
        if (!pt) { log.push([label, "ERROR no element " + sel]); continue }
        for (let i = 1; i <= 2; i++) {
          if (kind === "dbltap") {
            await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: pt.x, y: pt.y }] }, sessionId)
            await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }, sessionId)
          } else {
            await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: pt.x, y: pt.y, button: "left", clickCount: i }, sessionId)
            await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: pt.x, y: pt.y, button: "left", clickCount: i }, sessionId)
          }
          await sleep(40)
        }
        await sleep(wait)
        log.push([label, "done"]); continue
      }
      if (typeof js === "string" && /^@(hover|longpress|tap):/.test(js)) {
        const kind = js.slice(1, js.indexOf(":")); const sel = js.slice(js.indexOf(":") + 1)
        const pt = await ev(`const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + Math.min(r.height / 2, 20) }`)
        if (!pt) { log.push([label, "ERROR no element " + sel]); continue }
        if (kind === "hover") await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: pt.x, y: pt.y }, sessionId)
        else {
          await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: pt.x, y: pt.y }] }, sessionId)
          await sleep(kind === "longpress" ? 700 : 60)
          await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }, sessionId)
        }
        await sleep(wait)
        log.push([label, await ev(`const t = [...document.querySelectorAll(".pos-name-tip")].find((x) => getComputedStyle(x).display !== "none"); const cart = JSON.parse(localStorage.getItem("lebanonpos.cart.v1") || "null"); return (t ? "full name shown: " + t.textContent.trim() : "no full name shown") + "; focus: " + (document.activeElement?.className?.toString().includes("pos-tile-button") ? "tile" : document.activeElement?.tagName)`)])
        continue
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

// Shell top bar fit: every control visible inside the header, nothing clipped (no resize; fresh profile per size).
const topbarFit = ["top bar fit", `
  const h = document.querySelector("header.topbar-shell"); if (!h) return "no header"
  const hr = h.getBoundingClientRect()
  const clipped = [...h.querySelectorAll("button")].filter((b) => b.offsetParent !== null).filter((b) => { const r = b.getBoundingClientRect(); return r.left < hr.left - 1 || r.right > hr.right + 1 }).map((b) => b.getAttribute("aria-label") || b.textContent.trim().slice(0, 20))
  const truncated = [...h.querySelectorAll("button, button span")].filter((b) => b.offsetParent !== null && b.scrollWidth > b.clientWidth + 1).map((b) => (b.getAttribute("aria-label") || b.textContent.trim()).slice(0, 40))
  return "header " + Math.round(hr.width) + "px, content " + h.scrollWidth + "px; overflow=" + (h.scrollWidth > h.clientWidth + 1) + "; clipped: " + (clipped.join(", ") || "none") + "; truncated: " + (truncated.join(", ") || "none") + "; page overflowX=" + (document.documentElement.scrollWidth > innerWidth + 1)`, 100]
const SHELL = [
  ["shell-topbar.en.dark.tablet", { w: 768, h: 1024, mobile: true, steps: [openSheetFromChip, openShift, escSheet, topbarFit] }],
  ["shell-topbar.ar.dark.tablet", { w: 768, h: 1024, mobile: true, lang: "ar", steps: [openSheetFromChip, openShift, escSheet, topbarFit] }],
  ["shell-topbar.en.light.tablet-landscape", { w: 1024, h: 768, theme: "light", steps: [openShift, topbarFit] }],
  ["shell-topbar.en.dark.tablet-820", { w: 820, h: 1180, mobile: true, steps: [openSheetFromChip, openShift, escSheet, topbarFit] }],
  ["shell-topbar-noshift.en.dark.tablet", { w: 768, h: 1024, mobile: true, steps: [topbarFit] }],
  ["shell-topbar.en.dark.mobile", { w: 390, h: 844, mobile: true, steps: [openSheetFromChip, openShift, escSheet, topbarFit] }],
  ["shell-topbar.ar.light.mobile", { w: 390, h: 844, mobile: true, theme: "light", lang: "ar", steps: [openSheetFromChip, openShift, escSheet, topbarFit] }],
  ["shell-topbar.en.dark.mobile-360", { w: 360, h: 780, mobile: true, steps: [openSheetFromChip, openShift, escSheet, topbarFit] }],
]

// Long product names: two lines in the tile; the full name on hover, keyboard focus and long press.
const LONG_NAME = "Water Bottle 500ml Natural Mineral Spring, Family Pack of 6 Bottles"
const LONG_NAME_AR = "مياه معدنية طبيعية من الينابيع، عبوة عائلية من ست زجاجات سعة ٥٠٠ مل"
// A step (not setup): a fresh profile stores the demo catalogue only after its first load.
const longName = (name) => ["give one product a long name", `const k = "lebanonpos.products.v1"; let p = JSON.parse(localStorage.getItem(k) || "[]"); if (!p.length) { const m = await import("/src/features/pos/data/products.ts"); p = JSON.parse(JSON.stringify(m.products)) } const i = p.findIndex((x) => /Water Bottle/.test(x.name)); if (i < 0) throw new Error("no Water Bottle product"); p[i].name = ${JSON.stringify(name)}; localStorage.setItem(k, JSON.stringify(p)); setTimeout(() => location.reload(), 50); return "renamed; reloading"`, 3500]
const nameFacts = ["tile name", `const b = document.querySelector(".pos-tile-button[aria-describedby]"); if (!b) return "no clipped tile"; const p = b.querySelector("p"); const lines = Math.round(p.getBoundingClientRect().height / parseFloat(getComputedStyle(p).lineHeight)); return "clipped tile found; visible lines " + lines + "; accessible name has full text: " + b.textContent.includes(document.getElementById(b.getAttribute("aria-describedby")).textContent.trim()) + "; tooltip id linked: " + !!document.getElementById(b.getAttribute("aria-describedby"))`, 100]
const keyFocusTile = ["keyboard: Tab onto the tile", `const all = [...document.querySelectorAll("button, input, select, a[href], [tabindex]:not([tabindex='-1'])")].filter((e) => e.offsetParent !== null && !e.disabled); const target = document.querySelector(".pos-tile-button[aria-describedby]"); all[all.indexOf(target) - 1].focus(); return "focused the control before it"`, 100]
const tipVisible = ["full name visible?", `const t = [...document.querySelectorAll(".pos-name-tip")].find((x) => getComputedStyle(x).display !== "none"); return t ? "shown: " + t.textContent.trim() : "hidden"`, 50]
const cartLines = ["cart lines", `const c = JSON.parse(localStorage.getItem("lebanonpos.cart.v1") || "null"); const n = [...document.querySelectorAll(".mg2-paybar button")][0]; return n ? n.textContent.trim().slice(0, 30) : "no paybar"`, 50]
const cartName = ["cart line name", `const b = [...document.querySelectorAll("p[role=button][aria-expanded]")].find((x) => x.offsetParent !== null); if (!b) { const q = [...document.querySelectorAll("p")].find((x) => x.offsetParent !== null && x.textContent.startsWith("Water Bottle 500ml Natural") && !x.closest(".pos-product-tile")); return q ? "cart name fits, nothing cut (" + (q.scrollHeight <= q.clientHeight + 1) + "): " + q.textContent.trim() : "no cart line" } const p = b; return "expanded=" + b.getAttribute("aria-expanded") + "; lines " + Math.round(p.getBoundingClientRect().height / parseFloat(getComputedStyle(p).lineHeight)) + "; text complete in DOM: " + (p.textContent.trim().length > 40)`, 50]
const focusCartName = ["focus cart line name", `const b = [...document.querySelectorAll("p[role=button][aria-expanded]")].find((x) => x.offsetParent !== null); b.focus(); return document.activeElement === b ? "focused" : "not focused"`, 100]
const NAMES = [
  ["names-hover.en.dark.desktop", { w: 1440, h: 900, steps: [longName(LONG_NAME), openShift, nameFacts, tipVisible, ["mouse hover", "@hover:.pos-tile-button[aria-describedby]", 300]] }],
  ["names-keyboard.en.dark.desktop", { w: 1440, h: 900, steps: [longName(LONG_NAME), openShift, keyFocusTile, ["Tab (real key)", "@key:Tab:1", 300], tipVisible, ["Enter adds it (real key)", "@key:Enter:1", 600], cartName, focusCartName, ["Enter on the name (real key)", "@key:Enter:1", 300], cartName] }],
  ["names-longpress.en.dark.mobile", { w: 390, h: 844, mobile: true, steps: [longName(LONG_NAME), openSheetFromChip, openShift, escSheet, nameFacts, cartLines, ["long press (touch)", "@longpress:.pos-tile-button[aria-describedby]", 300], cartLines, ["short tap (touch)", "@tap:.pos-tile-button[aria-describedby]", 1200], cartLines, openCartSheet, cartName, ["tap the cart line name", "@tap:p[role=button][aria-expanded=\"false\"]", 400], cartName] }],
  ["names-longpress.ar.light.mobile", { w: 390, h: 844, mobile: true, theme: "light", lang: "ar", steps: [longName(LONG_NAME_AR), openSheetFromChip, openShift, escSheet, nameFacts, ["long press (touch)", "@longpress:.pos-tile-button[aria-describedby]", 300]] }],
]

// Visual review set: each scene in a fresh profile at its own size from the first paint.
const mobileShift = [openSheetFromChip, openShift, escSheet]
const printedReceipt = ["printed receipt (80 mm)", `
  let html = ""
  window.open = () => ({ document: { write: (h) => { html += h }, close() {} }, focus() {}, print() {}, close() {} })
  const b = __t.textBtn(/^(Print receipt|طباعة الإيصال|طباعة)/i); if (!b) throw new Error("no Print receipt button"); b.click()
  await new Promise((r) => setTimeout(r, 300)); if (!html) throw new Error("receipt not written")
  const wrap = document.createElement("div"); wrap.style.cssText = "position:fixed;inset:0;z-index:99999;background:#2a2d33;display:flex;justify-content:center;align-items:flex-start;padding:24px;overflow:auto"
  const frame = document.createElement("iframe"); frame.style.cssText = "width:320px;height:" + (innerHeight - 48) + "px;border:0;background:#fff;box-shadow:0 8px 30px rgba(0,0,0,.5)"; frame.srcdoc = html
  wrap.appendChild(frame); document.body.appendChild(wrap); await new Promise((r) => setTimeout(r, 600))
  return "receipt rendered (" + html.length + " chars)"`, 400]
const REVIEW = [
  ["review-full-pos.en.dark.desktop", { w: 1440, h: 900, steps: [openShift, addTiles, cashPaid] }],
  ["review-full-pos.en.dark.mobile", { w: 390, h: 844, mobile: true, steps: [...mobileShift, addTiles] }],
  ["review-cart-sheet.en.dark.mobile", { w: 390, h: 844, mobile: true, steps: [...mobileShift, addTiles, openCartSheet, cashPaid] }],
  ["review-simple-pos.en.dark.desktop", { w: 1440, h: 900, steps: [openShift, addTiles, quick, cashPaid] }],
  ["review-simple-pos.en.dark.mobile", { w: 390, h: 844, mobile: true, steps: [...mobileShift, addTiles, quick, cashPaid] }],
  ["review-payment.en.dark.desktop", { w: 1440, h: 900, steps: [openShift, addTiles, cashPaid, review] }],
  ["review-payment.en.dark.mobile", { w: 390, h: 844, mobile: true, steps: [...mobileShift, addTiles, openCartSheet, cashPaid, payInSheet] }],
  ["review-receipt.en.dark.desktop", { w: 1440, h: 900, steps: [openShift, addTiles, cashPaid, review, confirm] }],
  ["review-receipt.en.dark.mobile", { w: 390, h: 844, mobile: true, steps: [...mobileShift, addTiles, openCartSheet, cashPaid, payInSheet, confirm] }],
  ["review-printed-receipt.en.desktop", { w: 1440, h: 900, steps: [openShift, addTiles, cashPaid, review, confirm, printedReceipt] }],
  ["review-simple-review.en.dark.desktop", { w: 1440, h: 900, steps: [openShift, addTiles, quick, exactCash, ["Enter in the empty scan field", `const i = document.querySelector("input[aria-label*='next item' i]"); i.focus(); __t.key(i, "Enter"); return "ok"`, 600]] }],
  ["review-simple-review.en.dark.mobile", { w: 390, h: 844, mobile: true, steps: [...mobileShift, addTiles, quick, exactCash, ["Enter in the empty scan field", `const i = document.querySelector("input[aria-label*='next item' i]"); i.focus(); __t.key(i, "Enter"); return "ok"`, 600]] }],
  ["review-simple-header.ar.dark.mobile-360", { w: 360, h: 780, mobile: true, lang: "ar", steps: [...mobileShift, addTiles, quick] }],
  ["review-latest-sale.en.dark.mobile", { w: 390, h: 844, mobile: true, steps: [...mobileShift, addTiles, openCartSheet, exactCash, payInSheet, confirm, ["close the panel", `const b = [...document.querySelectorAll("button[aria-label]")].find((x) => /^(Close|Dismiss|إغلاق)/i.test(x.getAttribute("aria-label")) && x.closest(".mg2-receipt")); b?.click(); return b ? "closed" : "no close"`, 400], addTiles, openCartSheet, exactCash, payInSheet, confirm] }],
  ["review-full-pos.ar.light.desktop", { w: 1440, h: 900, theme: "light", lang: "ar", steps: [openShift, addTiles, cashPaid] }],
  ["review-payment.ar.light.mobile", { w: 390, h: 844, mobile: true, theme: "light", lang: "ar", steps: [...mobileShift, addTiles, openCartSheet, cashPaid, payInSheet] }],
]

// Printed receipt fit: both receipts, long English and Arabic names, large totals and the rounding lines,
// rendered at each roll's printable width in real Chrome. Every element must stay inside the body's
// content box (printable width minus the safe margin). A browser render is not a printer test.
const receiptFit = (configs) => ["receipt fit " + configs.map((c) => c.paperMm + "/" + c.printableMm + "/" + c.marginMm).join(", "), `
  const m = await import("/src/features/pos/lib/printReceipt.ts")
  const settings = { storeName: "متجر تيتان — Titan Mini Market Hamra", branchName: "Hamra Main Street Branch", phone: "+961 70 000 000", address: "Bliss Street, Hamra, Beirut, Lebanon", vatRate: 0.11, receiptFooter: "شكراً لزيارتكم — Thank you for shopping with us, see you again soon." }
  const items = [
    { id: 1, name: "Water Bottle 500ml Natural Mineral Spring, Family Pack of 6 Bottles", barcode: "5281001000031234", quantity: 12, price: 1234.5 },
    { id: 2, name: "مياه معدنية طبيعية من الينابيع، عبوة عائلية من ست زجاجات سعة ٥٠٠ مل", barcode: "5281001000032", quantity: 1, price: 0.45 },
    { id: 3, name: "Pepsi", barcode: "", quantity: 2, price: 0.9 },
  ]
  const total = 16467.26, rate = 89500
  const tender = { paidUsd: 20000, paidLbp: 2500000, paidTotalUsd: 20027.93, paidTotalLbp: 1792500000, changeUsd: 3560.67, changeLbp: 318680000, changeCurrency: "USD", exchangeRate: rate, currency: "Mixed" }
  const last = { number: "S-HAMRA2-000123", paymentMethod: "Cash", customerName: "عبد الرحمن الخطيب", grossSubtotal: 14837.25, subtotal: 14835.55, discountTotal: 1.7, tax: 1631.71, total, totalLbp: Math.round(total * rate), payableLbp: Math.ceil(total * rate / 5000) * 5000, payableUsd: 16467.32, exchangeRate: rate, tender, customerBalanceBefore: 1250, customerBalanceAfter: 1250, items }
  const sale = { id: "s1", saleNumber: last.number, createdAt: new Date().toISOString(), cashier: "Omar Abdel-Rahman Al-Khatib", paymentMethod: "Cash", customerName: last.customerName, subtotal: last.subtotal, discountTotal: 1.7, tax: last.tax, total, payableLbp: last.payableLbp, tender, items: items.map((i) => ({ ...i, unitPrice: i.price, total: i.price * i.quantity })) }
  const render = (fn) => { let html = ""; const open = window.open; window.open = () => ({ document: { write: (h) => { html += h }, close() {} }, focus() {}, print() {}, close() {} }); try { fn() } finally { window.open = open } return html }
  const mmPx = 96 / 25.4
  const wrap = document.createElement("div"); wrap.style.cssText = "position:fixed;inset:0;z-index:99999;background:#2a2d33;display:flex;gap:16px;padding:16px;overflow:auto;align-items:flex-start"
  document.body.appendChild(wrap)
  const out = []
  for (const cfg of ${JSON.stringify(configs)}) {
    localStorage.setItem("lebanonpos.receipt-printer.v1", JSON.stringify(cfg))
    for (const [kind, html] of [["register", render(() => m.printLastSaleReceipt(last, settings))], ["reprint", render(() => m.printSaleReceipt(sale, rate, [], settings))]]) {
      const box = document.createElement("div"); box.style.cssText = "display:flex;flex-direction:column;gap:4px;color:#ccc;font:12px system-ui"
      const label = document.createElement("div"); label.textContent = kind + " · roll " + cfg.paperMm + " mm · printable " + cfg.printableMm + " mm · margin " + cfg.marginMm + " mm"
      const frame = document.createElement("iframe"); frame.style.cssText = "border:0;background:#fff;width:" + Math.round(cfg.paperMm * mmPx) + "px;height:" + (innerHeight - 70) + "px"
      box.append(label, frame); wrap.appendChild(box); frame.srcdoc = html
      await new Promise((r) => frame.onload = r)
      const d = frame.contentDocument, body = d.body, cs = d.defaultView.getComputedStyle(body)
      const br = body.getBoundingClientRect(), left = br.left + parseFloat(cs.paddingLeft) - 0.5, right = br.right - parseFloat(cs.paddingRight) + 0.5
      const outside = [...body.querySelectorAll("*")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.left < left || r.right > right) }).map((e) => e.tagName + ":" + e.textContent.trim().slice(0, 24))
      const clippedText = [...body.querySelectorAll("*")].filter((e) => e.scrollWidth > e.clientWidth + 1 && e.clientWidth > 0).map((e) => e.textContent.trim().slice(0, 24))
      const has = ["Cash rounding", "Cash payable", "16,467.26", "Thank you"].filter((t) => !body.textContent.includes(t))
      const arabicRtl = [...body.querySelectorAll("[dir=auto]")].some((e) => /[\u0600-\u06FF]/.test(e.textContent) && d.defaultView.getComputedStyle(e).direction === "rtl")
      out.push(kind + " " + cfg.paperMm + "/" + cfg.printableMm + "/" + cfg.marginMm + ": body " + Math.round(br.width) + "px (" + (br.width / mmPx).toFixed(1) + " mm), outside=" + (outside.length ? outside.join("|") : "none") + ", clipped=" + (clippedText.length ? clippedText.join("|") : "none") + (has.length ? ", MISSING " + has.join("/") : "") + ", arabic rtl=" + arabicRtl + ", page overflow=" + (d.documentElement.scrollWidth > d.documentElement.clientWidth))
    }
  }
  localStorage.removeItem("lebanonpos.receipt-printer.v1")
  return out.join(" ;; ")`, 300]
const RECEIPT = [
  ["receipt-fit-80.desktop", { w: 1440, h: 1100, steps: [receiptFit([{ paperMm: 80, printableMm: 72, marginMm: 2 }, { paperMm: 80, printableMm: 72, marginMm: 0 }])] }],
  ["receipt-fit-58.desktop", { w: 1440, h: 1100, steps: [receiptFit([{ paperMm: 58, printableMm: 48, marginMm: 2 }, { paperMm: 58, printableMm: 48, marginMm: 4 }])] }],
]

// Payment review: the background (Pay bar, cart sheet, rail, shell) is inert; one confirm = one sale.
const salesCount = ["sales recorded", `const n = JSON.parse(localStorage.getItem("lebanonpos.sales.v1") || "[]").length; const q = JSON.parse(localStorage.getItem("lebanonpos.sync-queue.v1") || "[]").filter((o) => o.entity === "sale" && o.action === "create").length; return n + " sale(s), " + q + " queued; review " + (document.querySelector("[aria-labelledby=mg2-review-title]") ? "OPEN" : "closed")`, 50]
const backgroundInert = ["background while review is open", `
  const d = document.querySelector("[aria-labelledby=mg2-review-title]"); if (!d) return "no review open"
  const pay = document.querySelector(".mg2-paybar .mg2-pay"); const cart = document.querySelector(".mg2-paybar button")
  const sheetPay = [...document.querySelectorAll(".mg2-pay")].find((x) => !x.closest(".mg2-paybar") && !d.contains(x))
  const inertOf = (el) => el ? (el.closest("[inert]") ? "inert" : "LIVE") : "absent"
  pay?.focus(); const focusAfter = d.contains(document.activeElement) ? "focus stayed in review" : "FOCUS MOVED to " + (document.activeElement?.className || document.activeElement?.tagName)
  const topbar = document.querySelector("header.topbar-shell")
  return "pay bar " + inertOf(pay) + ", cart button " + inertOf(cart) + ", sheet pay " + inertOf(sheetPay) + ", top bar " + inertOf(topbar) + "; " + focusAfter`, 50]
const whatIsUnderPayBar = ["what a finger on the visible Pay bar would hit", `const p = document.querySelector(".mg2-paybar .mg2-pay"); const r = p.getBoundingClientRect(); const pts = [[r.left + r.width / 2, r.top + 20], [r.left + r.width / 2, r.top + r.height / 2], [r.left + r.width / 2, r.bottom - 6]]; const d = document.querySelector("[aria-labelledby=mg2-review-title]"); return pts.map(([x, y]) => { const e = document.elementFromPoint(x, y); return Math.round(y) + "px: " + (d && d.contains(e) ? "review dialog " + (e.closest("button")?.textContent.trim().slice(0, 16) || e.tagName) : e?.closest(".mg2-paybar") ? "PAY BAR" : "backdrop") }).join("; ") + " (pay bar spans " + Math.round(r.top) + "–" + Math.round(r.bottom) + "px, dialog ends " + Math.round(d.getBoundingClientRect().bottom) + "px)"`, 50]
const tapPayBar = ["real tap on the Pay bar", "@tap:.mg2-paybar .mg2-pay", 400]
const enterScanEmpty = ["Enter in the empty scan field opens review", `const i = document.querySelector("input[aria-label*=Scan i]"); i.focus(); __t.type(i, ""); __t.key(i, "Enter"); await new Promise((r) => setTimeout(r, 300)); return document.querySelector("[aria-labelledby=mg2-review-title]") ? "review open" : "no review"`, 300]
// Store-hub write-through: the sale waits for the server. Simulated: /api/sync/push answers "ok" after 2.5 s.
const asStoreHub = `localStorage.setItem("lebanonpos.connection-mode.v1", "STORE_HUB"); localStorage.setItem("lebanonpos.api-url", "http://localhost:3015"); localStorage.setItem("lebanonpos.auth-token", "qa-test-token")`
const slowHub = ["simulate a slow store hub (2.5 s commit)", `window.__push = 0; const real = window.fetch; window.fetch = async (u, o) => { if (String(u).includes("/api/sync/push") && String(o?.body || "").includes("\\"entity\\":\\"sale\\"")) { window.__push++; await new Promise((r) => setTimeout(r, 2500)); return new Response(JSON.stringify({ results: [{ id: "x", status: "ok" }] }), { status: 200, headers: { "Content-Type": "application/json" } }) } return real(u, o) }; return "fetch stubbed"`, 50]
const inFlight = ["during the commit", `return "server commits started: " + window.__push + "; review " + (document.querySelector("[aria-labelledby=mg2-review-title]") ? "REOPENED" : "closed") + "; status: " + (document.querySelector("[role=status]")?.textContent.trim().slice(0, 60) || "")`, 50]
const railPay = ["click the rail Pay button during the commit", `const b = [...document.querySelectorAll(".mg2-pay")].find((x) => x.offsetParent !== null && !x.closest("[aria-labelledby=mg2-review-title]")); if (!b) return "no rail pay"; b.click(); await new Promise((r) => setTimeout(r, 200)); return "clicked (" + (b.disabled ? "disabled" : "enabled") + "); review " + (document.querySelector("[aria-labelledby=mg2-review-title]") ? "REOPENED" : "closed")`, 50]
const afterCommit = ["after the commit", `await new Promise((r) => setTimeout(r, 3200)); return "server commits: " + window.__push + "; local sales: " + JSON.parse(localStorage.getItem("lebanonpos.sales.v1") || "[]").length + "; cart lines: " + document.querySelectorAll("[aria-label^=Increase]").length`, 50]
const PAY = [
  ["pay-doubletap.en.dark.mobile", { w: 390, h: 844, mobile: true, steps: [openSheetFromChip, openShift, escSheet, addTiles, openCartSheet, exactCash, payInSheet, backgroundInert, salesCount, ["rapid double-tap on Confirm", "@dbltap:[aria-labelledby=mg2-review-title] .mg2-pay", 900], salesCount] }],
  ["pay-bar-hidden.en.dark.mobile", { w: 390, h: 844, mobile: true, steps: [openSheetFromChip, openShift, escSheet, addTiles, openCartSheet, exactCash, payInSheet, whatIsUnderPayBar, ["other Pay controls visible?", `const d = document.querySelector("[aria-labelledby=mg2-review-title]"); const shown = [...document.querySelectorAll(".mg2-paybar, .mg2-pay")].filter((x) => !d.contains(x) && x.getClientRects().length && getComputedStyle(x).visibility !== "hidden"); return shown.length ? "VISIBLE: " + shown.map((x) => x.className).join(", ") : "none visible (Pay bar and cart-sheet Pay hidden)"`, 50], ["mark the bottom 12 px (where only the Pay bar was)", `const p = document.querySelector(".mg2-paybar").getBoundingClientRect(); const m = document.createElement("div"); m.id = "__tapTarget"; m.style.cssText = "position:fixed;left:" + (p.left + 40) + "px;width:" + (p.width - 80) + "px;top:" + (p.bottom - 12) + "px;height:12px;pointer-events:none"; document.body.appendChild(m); const e = document.elementFromPoint(p.left + p.width / 2, p.bottom - 6); return "at that point: " + (e?.closest("[aria-labelledby=mg2-review-title]") ? "review dialog" : e?.closest(".mg2-paybar") ? "PAY BAR" : "backdrop")`, 50], ["real tap there", "@tap:#__tapTarget", 400], salesCount] }],
  ["pay-repeated-enter.en.dark.desktop", { w: 1440, h: 900, steps: [openShift, addTiles, exactCash, enterScanEmpty, backgroundInert, ["Enter ×6, 80 ms apart (real keys)", "@key:Enter:6", 900], salesCount] }],
  ["pay-doubleclick.en.dark.desktop", { w: 1440, h: 900, steps: [openShift, addTiles, exactCash, review, ["rapid double-click on Confirm", "@dblclick:[aria-labelledby=mg2-review-title] .mg2-pay", 900], salesCount] }],
  ["pay-slow-hub.en.dark.desktop", { w: 1440, h: 900, setup: asStoreHub, steps: [openShift, addTiles, exactCash, slowHub, enterScanEmpty, ["Enter confirms (real key)", "@key:Enter:1", 200], inFlight, ["Enter ×5 in the scan field during the commit", "@key:Enter:5", 150], inFlight, railPay, afterCommit] }],
  ["pay-inert.ar.light.mobile", { w: 390, h: 844, mobile: true, theme: "light", lang: "ar", steps: [openSheetFromChip, openShift, escSheet, addTiles, openCartSheet, exactCash, payInSheet, backgroundInert, ["Tab ×8 (real keys)", "@key:Tab:8", 150], ["Enter ×4 (real keys)", "@key:Enter:4", 900], salesCount] }],
]

// Five register fixes: one Enter rule, Simple POS behind review, one latest-sale panel, Clear sale fits, scan attribution.
const st = (label) => [label, `await new Promise((r) => setTimeout(r, 150)); const a = document.activeElement; const tender = a?.getAttribute("data-tender"); return "focus: " + (tender ? "Paid " + tender.toUpperCase() : (a?.getAttribute("aria-label") || a?.tagName)) + "; review " + (document.querySelector("[aria-labelledby=mg2-review-title]") ? "OPEN" : "closed") + "; simple " + (document.querySelector("input[placeholder*='next item' i], input[aria-label*='next item' i]") ? "mounted" : "absent") + "; status: " + ([...document.querySelectorAll("[role=status]")].map((x) => x.textContent.trim()).find(Boolean) || "").slice(0, 60)`, 50]
const scanText = (q) => ["type " + JSON.stringify(q) + " in the scan field", `const i = [...document.querySelectorAll("input[aria-label*='Scan' i], input[aria-label*='next item' i]")].find((x) => x.offsetParent !== null); i.focus(); __t.type(i, ${JSON.stringify(q)}); return "typed"`, 100]
const focusScan2 = ["focus the empty scan field", `const i = [...document.querySelectorAll("input[aria-label*='Scan' i], input[aria-label*='next item' i]")].find((x) => x.offsetParent !== null); __t.type(i, ""); i.focus(); return "ok"`, 100]
const enter = ["Enter (real key)", "@key:Enter:1", 400]
const esc = ["Esc (real key)", "@key:Escape:1", 400]
const typeTender = (field, v) => ["type " + v + " in Paid " + field.toUpperCase(), `const i = [...document.querySelectorAll("input[data-tender=${field}]")].find((x) => x.offsetParent !== null); i.focus(); __t.type(i, "${v}"); return "ok"`, 150]
const snapshot = ["cart and tender", `return "lines " + document.querySelectorAll("[aria-label^='Increase'], [aria-label^='زيادة']").length + "; USD=" + ([...document.querySelectorAll("input[data-tender=usd]")].find((x) => x.offsetParent !== null)?.value ?? "-") + "; LBP=" + ([...document.querySelectorAll("input[data-tender=lbp]")].find((x) => x.offsetParent !== null)?.value ?? "-")`, 50]
const simpleBehind = ["Simple POS behind the dialog", `const d = document.querySelector("[aria-labelledby=mg2-review-title]"); const sec = [...document.querySelectorAll("section.mg2.fixed")].find((x) => !x.contains(d)); return d ? ("Simple POS " + (sec ? "mounted, " + (sec.closest("[inert]") ? "inert" : "LIVE") : "MISSING")) : "no review"`, 50]
const banners = ["latest-sale panel", `const g = document.querySelector("[aria-label='Recent receipts'], [aria-label*='receipts' i]"); const rows = g ? [...g.children].length : 0; const hist = !!document.querySelector("a[href='/sales'][aria-label]"); return rows + " row(s); first: " + (g?.children[0]?.textContent.trim().slice(0, 28) || "-") + "; Sales history link: " + hist`, 50]
const clearFits = ["Clear sale control", `const b = [...document.querySelectorAll("section.mg2.fixed button")].find((x) => /^(Clear sale|مسح البيع)$/.test(x.getAttribute("aria-label") || "")); if (!b) return "no Clear button"; const h = b.closest("div").getBoundingClientRect(); const r = b.getBoundingClientRect(); return "name '" + b.getAttribute("aria-label") + "', " + Math.round(r.width) + "x" + Math.round(r.height) + " at " + Math.round(r.left) + "–" + Math.round(r.right) + " of " + innerWidth + "px; clipped=" + (r.left < 0 || r.right > innerWidth + 0.5) + "; header overflow=" + (document.querySelector("section.mg2.fixed > div").scrollWidth > document.querySelector("section.mg2.fixed > div").clientWidth + 1)`, 50]
const tapClear = ["tap Clear sale", `const b = [...document.querySelectorAll("section.mg2.fixed button")].find((x) => /^(Clear sale|مسح البيع)$/.test(x.getAttribute("aria-label") || "")); b.click(); await new Promise((r) => setTimeout(r, 400)); const dlg = [...document.querySelectorAll("[role=alertdialog][aria-modal=true]")].find((x) => x.offsetParent !== null); if (!dlg) return "NO confirmation"; const r = dlg.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return "confirmation " + (dlg.contains(top) ? "visible on top" : "HIDDEN behind " + (top?.className?.toString().slice(0, 30))) + ": " + dlg.textContent.trim().slice(0, 50)`, 100]
const cancelConfirm = ["cancel the confirmation", `const b = [...document.querySelectorAll("button")].find((x) => x.offsetParent !== null && /^(Cancel|إلغاء)$/i.test(x.textContent.trim())); if (!b) return "no Cancel"; b.click(); await new Promise((r) => setTimeout(r, 400)); return "cancelled"`, 50]
const tapTile = (i) => ["tap product tile " + i, `const t = [...document.querySelectorAll(".pos-tile-button")][${i}]; t.click(); await new Promise((r) => setTimeout(r, 200)); return t.querySelector("p").textContent`, 200]
const FIVE = [
  ["five-enter.en.dark.desktop", { w: 1440, h: 900, steps: [openShift, scanText("pepsi"), enter, st("1a text → search"), tapTile(0), st("1b tile"), focusScan2, enter, st("1c empty, nothing paid → Paid USD"), typeTender("usd", "1"), enter, st("1d USD short → Paid LBP"), enter, st("1e LBP short → stays"), typeTender("usd", "20"), enter, st("1f payable → review"), esc, st("1g Back → focus returns to Paid USD"), snapshot] }],
  ["five-enter-simple.en.dark.desktop", { w: 1440, h: 900, steps: [openShift, quick, scanText("528100100002"), enter, st("5a barcode → (barcode)"), scanText("chips"), enter, st("5b name → (search)"), focusScan2, enter, st("1c empty, nothing paid → Paid USD"), typeTender("lbp", "100000"), focusScan2, enter, st("1c' paying LBP → Paid LBP"), exactCash, focusScan2, enter, st("1f payable → review"), simpleBehind, esc, st("2 Back → Simple POS kept, focus back in scan"), snapshot] }],
  ["five-enter.en.dark.mobile", { w: 390, h: 844, mobile: true, steps: [openSheetFromChip, openShift, escSheet, tapTile(1), st("1b tile (tap)"), focusScan2, enter, st("1c phone: empty, nothing paid → cart sheet + Paid USD")] }],
  ["five-banner.en.dark.desktop", { w: 1440, h: 900, steps: [openShift, addTiles, exactCash, review, confirm, banners, addTiles, exactCash, review, confirm, banners] }],
  ["five-clear.en.dark.mobile", { w: 390, h: 844, mobile: true, steps: [openSheetFromChip, openShift, escSheet, addTiles, quick, clearFits, tapClear, cancelConfirm, snapshot] }],
  ["five-clear.ar.dark.mobile", { w: 390, h: 844, mobile: true, lang: "ar", steps: [openSheetFromChip, openShift, escSheet, addTiles, quick, clearFits, tapClear] }],
  ["five-clear.en.dark.mobile-360", { w: 360, h: 780, mobile: true, steps: [openSheetFromChip, openShift, escSheet, addTiles, quick, clearFits] }],
  ["five-clear.ar.light.mobile-360", { w: 360, h: 780, mobile: true, theme: "light", lang: "ar", steps: [openSheetFromChip, openShift, escSheet, addTiles, quick, clearFits, tapClear] }],
]

// Stock workspace (Products, Lots, Receiving). Each scene opens its route directly in a fresh profile.
// seedStock: a real delivery through the app's own services (dev data): three lots with
// different expiries (5 days, 20 days, expired 2 days ago) from one supplier.
const seedStock = ["seed a delivery", `
  const ps = await import("/src/features/pos/services/product.service.ts")
  const sup = await import("/src/features/pos/services/supplier.service.ts")
  const sec = await import("/src/features/pos/services/security.service.ts")
  const sales = await import("/src/features/pos/services/sales.service.ts")
  if (!sec.getActiveShift()) sec.openShift(100)
  if (!sup.getSupplierLedger().length) sup.createSupplier({ name: "Malia Group", mobile: "01 000 000", contact: "Karim", address: "Dora", notes: "" })
  const sp = sup.getSupplierLedger()[0]
  const d = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10)
  const all = await ps.getProducts(); const by = (n) => all.find((p) => p.name === n)
  await sup.receiveAndRecord([
    { name: "Pepsi Can", barcode: by("Pepsi Can").barcode, category: "Drinks", quantity: 24, cost: 0.55, price: 0.9, expiryDate: d(5) },
    { name: "Labneh 500g", barcode: by("Labneh 500g").barcode, category: "Pantry", quantity: 10, cost: 1.6, price: 2.4, expiryDate: d(20) },
    { name: "Chips", barcode: by("Chips").barcode, category: "Snacks", quantity: 30, cost: 0.42, price: 0.75, expiryDate: d(-2) },
  ], sp ? { supplierId: sp.id, supplierName: sp.name, invoiceNumber: "INV-77431", paymentMethod: "On Account" } : undefined)
  return "received; supplier " + (sp ? sp.name : "none")`, 800]
const reloadStep = ["reload", "setTimeout(() => location.reload(), 50); return 1", 3500]
// Receiving behaviour: scan merge, unknown code, Save with problems, save-ready-only (double-clicked),
// no double receive, and the draft surviving a reload. Each step reports what it observed.
const rcvStock = (label) => [label, `const ps = await import("/src/features/pos/services/product.service.ts"); const p = (await ps.getProducts()).find((x) => x.name === "Pepsi Can"); window.__pepsi = p.barcode; const lots = (await import("/src/features/pos/services/inventoryBatch.service.ts")).getInventoryBatches().filter((b) => b.productId === p.id); return "Pepsi stock " + p.stock + "; lots " + lots.length + " (" + lots.map((b) => b.initialQuantity).join("+") + ")"`, 100]
const rcvScan = (code) => ["scan " + code + " + Enter", `const i = document.querySelector("input[aria-label^='Scan items' i], input[aria-label^='امسح' i]"); i.focus(); __t.type(i, ${code === "PEPSI" ? "window.__pepsi" : JSON.stringify(code)}); await new Promise((r) => setTimeout(r, 50)); i.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); await new Promise((r) => setTimeout(r, 300)); const rows = [...document.querySelectorAll("tr[data-row]")]; return rows.length + " row(s): " + rows.map((r) => (r.querySelector("td")?.textContent.trim().slice(0, 40) || "?") + " qty " + (r.querySelector("input[type=number]")?.value || "-")).join(" | ") + "; status: " + ([...document.querySelectorAll("[role=status]")].map((x) => x.textContent.trim()).find(Boolean) || "").slice(0, 80)`, 300]
const rcvSave = ["press Save delivery", `const b = __t.textBtn(/^(Save delivery|حفظ الشحنة)/); if (!b) return "Save not found/disabled"; b.click(); await new Promise((r) => setTimeout(r, 500)); const a = document.activeElement; return "focus: " + (a?.getAttribute("aria-label") || a?.getAttribute("placeholder") || a?.tagName) + " in row " + (a?.closest("[data-row],[data-row-detail]") ? "yes" : "no") + "; banner: " + (document.querySelector(".mg2-banner")?.textContent.trim().slice(0, 70) || "-")`, 300]
const rcvReadyOnly = ["Save ready rows only (clicked twice in one tick)", `const b = __t.textBtn(/^(Save the|حفظ الأسطر الجاهزة)/); if (!b) return "no ready-only button"; b.click(); b.click(); await new Promise((r) => setTimeout(r, 1500)); const rows = [...document.querySelectorAll("tr[data-row]")]; return "rows left " + rows.length + ": " + rows.map((r) => r.querySelector("td")?.textContent.trim().slice(0, 30)).join(" | ") + "; banner: " + (document.querySelector(".mg2-t-ok")?.textContent.trim().slice(0, 80) || "-")`, 300]
const rcvSaveAgain = ["press Save again", `const b = [...document.querySelectorAll("button")].find((x) => /^(Save delivery|حفظ الشحنة)/.test(x.textContent.trim())); b?.click(); await new Promise((r) => setTimeout(r, 800)); return "Save " + (b?.disabled ? "disabled" : "enabled") + "; focus: " + (document.activeElement?.getAttribute("aria-label") || document.activeElement?.tagName)`, 300]
const rcvDraft = ["after reload", `await new Promise((r) => setTimeout(r, 300)); const rows = [...document.querySelectorAll("tr[data-row]")]; return "draft banner: " + ([...document.querySelectorAll(".mg2-banner")].map((x) => x.textContent.trim()).find((x) => /unsaved|غير المحفوظة/.test(x))?.slice(0, 60) || "NONE") + "; rows " + rows.length + ": " + rows.map((r) => r.querySelector("td")?.textContent.trim().slice(0, 30)).join(" | ")`, 100]
const RCV_FLOW = [rcvStock("before"), rcvScan("PEPSI"), rcvScan("PEPSI"), rcvScan("6291000999001"), rcvSave]
// Products behaviour: search, view chip, bulk archive, editor validation, delete guard, Cashier permissions.
const prodRows = `[...document.querySelectorAll("table[aria-label] tbody tr")].filter((r) => r.querySelector("input[type=checkbox]"))`
const prodSearch = (q) => ["search " + JSON.stringify(q), `const i = document.querySelector("input[type=search]"); __t.type(i, ${JSON.stringify(q)}); await new Promise((r) => setTimeout(r, 500)); const rows = ${prodRows}; return rows.length + " row(s): " + rows.map((r) => r.querySelector("td:nth-child(2)")?.textContent.trim().slice(0, 20)).join(", ")`, 100]
const prodChip = (re) => ["view chip " + re, `const b = __t.byText(".mg2-chips button", ${re}); b.click(); await new Promise((r) => setTimeout(r, 300)); const rows = ${prodRows}; return (b.getAttribute("aria-pressed") === "true" ? "pressed" : "NOT pressed") + "; url " + location.search + "; " + rows.length + " row(s): " + rows.map((r) => r.querySelector("td:nth-child(2)")?.textContent.trim().slice(0, 20)).join(", ")`, 100]
const prodBulkArchive = ["select 2 rows + bulk Archive", `const rows = ${prodRows}; rows[0].querySelector("input").click(); rows[1].querySelector("input").click(); await new Promise((r) => setTimeout(r, 200)); const bar = document.querySelector(".mg2-bulkbar"); const b = [...bar.querySelectorAll("button")].find((x) => /^(Archive|أرشفة)$/.test(x.textContent.trim())); if (b.disabled) return "bar: " + bar.querySelector("strong").textContent + "; Archive DISABLED"; b.click(); await new Promise((r) => setTimeout(r, 400)); const c = __t.textBtn(/^(Archive|أرشفة)/); if (c && c.closest("[role=alertdialog],[role=dialog]")) { c.click(); await new Promise((r) => setTimeout(r, 400)) } const archived = __t.byText(".mg2-chips button", /Archived|مؤرشف/); return "archived chip: " + archived.textContent.trim() + "; rows now " + ${prodRows}.length`, 100]
const prodEditorEmpty = ["Add product + Save empty", `const b = __t.textBtn(/^(Add product|إضافة منتج)$/); if (!b) return "Add product DISABLED: " + ([...document.querySelectorAll("button")].find((x) => /Add product|إضافة منتج/.test(x.textContent))?.getAttribute("aria-describedby") ? "with reason" : "no reason"); b.click(); await new Promise((r) => setTimeout(r, 500)); const d = document.querySelector("[role=dialog]"); const s = [...d.querySelectorAll("button")].find((x) => /^(Save|حفظ|Create|إنشاء)/.test(x.textContent.trim())); s.click(); await new Promise((r) => setTimeout(r, 300)); const a = document.activeElement; return "focus: " + (a?.getAttribute("aria-label") || a?.closest("label")?.textContent.trim().slice(0, 20) || a?.tagName) + " invalid=" + a?.getAttribute("aria-invalid") + "; errors: " + [...d.querySelectorAll("[aria-invalid=true]")].length`, 200]
const prodDetail = (name) => ["open " + name + " details", `const r = ${prodRows}.find((x) => x.textContent.includes(${JSON.stringify(name)})); r.querySelector("td:nth-child(2)").click(); await new Promise((r) => setTimeout(r, 500)); const d = document.querySelector("[role=dialog]"); const btns = [...d.querySelectorAll("button, a")].map((x) => x.getAttribute("aria-label") || x.textContent.trim().slice(0, 24)).filter(Boolean); return "actions: " + btns.slice(0, 12).join(" | ") + "; lots shown " + d.querySelectorAll(".mg2-lot").length`, 200]
// Receiving recovery in the app. "crash" = the page is reloaded with the draft still holding the
// in-flight save, written exactly as the page writes it (draft first, then receiveAndRecord).
const recSetup = (mode) => ["receive with " + mode + ", then a crash", `
  const L = await import("/src/features/pos/lib/receiveRows.ts")
  const S = await import("/src/features/pos/services/receiveSubmission.service.ts")
  const sup = await import("/src/features/pos/services/supplier.service.ts")
  const ps = await import("/src/features/pos/services/product.service.ts")
  const sec = await import("/src/features/pos/services/security.service.ts")
  if (!sec.getActiveShift()) sec.openShift(100)
  if (!sup.getSupplierLedger().length) sup.createSupplier({ name: "Malia Group", mobile: "01 000 000", contact: "Karim", address: "Dora", notes: "" })
  const supplier = sup.getSupplierLedger()[0]
  const p = (await ps.getProducts()).find((x) => x.name === "Pepsi Can")
  const sent = { ...L.addScan([L.createRow()], p.barcode, p).rows[0], quantity: 6, cost: 0.55, price: 0.9 }
  const fresh = { ...L.createRow(), name: "Zaatar Mix 1kg", barcode: "6291000999002", scannedBarcode: "6291000999002", category: "Pantry", quantity: 4, cost: 3, price: 5, mode: "new", decisionConfirmed: true }
  const id = "receive-qa-" + "${mode}".replace(/\\W+/g, "-")
  const failKey = { "a finished save": null, "the lots failing": "lebanonpos.inventory-batches.v1", "the payment failing": "lebanonpos.supplier-payments.v1", "the queue failing": "lebanonpos.sync-queue.v1" }["${mode}"]
  const rows = [sent, fresh]
  S.writeReceiveDraft(L.serializeDraft({ rows, supplierId: supplier.id, invoiceNumber: "INV-55", paymentMethod: "Cash", note: "", pending: { submissionId: id, rowIds: rows.map((r) => r.id) } }))
  const setItem = Storage.prototype.setItem
  if (failKey) Storage.prototype.setItem = function (k, v) { if (k === failKey) throw new DOMException("quota", "QuotaExceededError"); return setItem.call(this, k, v) }
  let outcome
  try { const r = await sup.receiveAndRecord(rows.map(L.toReceiveEntry), { supplierId: supplier.id, supplierName: supplier.name, invoiceNumber: "INV-55", paymentMethod: "Cash", note: "" }, { submissionId: id }); outcome = "PO " + r.purchaseOrder.status + " " + (r.purchaseOrder.number || "") + ", payment " + r.payment.status }
  catch (e) { outcome = e.name }
  finally { Storage.prototype.setItem = setItem }
  if ("${mode}" === "the queue failing") {
    // three Pepsi sold from the new lot before its receive could be sent
    const lots = JSON.parse(localStorage.getItem("lebanonpos.inventory-batches.v1") || "[]")
    const lot = lots.find((b) => b.id === id + "-lot-0"); if (lot) { lot.quantityRemaining -= 3; localStorage.setItem("lebanonpos.inventory-batches.v1", JSON.stringify(lots)) }
  }
  return outcome + "; Pepsi stock " + (await ps.getProducts()).find((x) => x.name === "Pepsi Can").stock`, 300]
const recState = ["after reopening", `await new Promise((r) => setTimeout(r, 300)); const ps = await import("/src/features/pos/services/product.service.ts"); const stock = (await ps.getProducts()).find((x) => x.name === "Pepsi Can").stock; const rows = [...document.querySelectorAll("tr[data-row]")].map((r) => r.querySelector("td")?.textContent.trim().slice(0, 44)); const save = [...document.querySelectorAll("button")].find((x) => /^(Save delivery|حفظ الشحنة)/.test(x.textContent.trim())); return "banners: " + [...document.querySelectorAll(".mg2-banner")].map((b) => b.textContent.trim().slice(0, 90)).join(" || ") + "; rows: " + rows.join(" | ") + "; Save " + (save?.disabled ? "DISABLED" : "enabled") + "; Pepsi stock " + stock`, 100]
const recRetry = ["press Save (retry)", `const b = [...document.querySelectorAll("button")].find((x) => /^(Save delivery|حفظ الشحنة)/.test(x.textContent.trim())); b.click(); await new Promise((r) => setTimeout(r, 1200)); const ps = await import("/src/features/pos/services/product.service.ts"); const ib = await import("/src/features/pos/services/inventoryBatch.service.ts"); const p = (await ps.getProducts()).find((x) => x.name === "Pepsi Can"); return "Pepsi stock " + p.stock + "; Pepsi lots " + ib.getInventoryBatches().filter((x) => x.productId === p.id).map((x) => x.initialQuantity).join("+")`, 100]
// A user who may receive but not adjust stock (no inventory.adjust): Complete allowed, Undo/close not.
const asReceiver = `(()=>{ const u = JSON.parse(localStorage.getItem("lebanonpos.users.v1") || "[]"); if (u[0]) { u[0].role = "Cashier"; u[0].permissions = ["sales.checkout", "inventory.view", "inventory.receive"]; localStorage.setItem("lebanonpos.users.v1", JSON.stringify(u)) } })()`
const uiSupplier = ["add supplier Malia Group", `const sup = await import("/src/features/pos/services/supplier.service.ts"); if (!sup.getSupplierLedger().length) sup.createSupplier({ name: "Malia Group", mobile: "01 000 000", contact: "Karim", address: "Dora", notes: "" }); return "ok"`, 200]
const uiSaveCashPaymentFails = ["pick supplier + Cash, Save with the payment write failing", `
  const sel = [...document.querySelectorAll("select")].find((s) => [...s.options].some((o) => /Malia/.test(o.textContent)))
  const opt = [...sel.options].find((o) => /Malia/.test(o.textContent)); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(sel, opt.value); sel.dispatchEvent(new Event("change", { bubbles: true }))
  await new Promise((r) => setTimeout(r, 200))
  const cash = [...document.querySelectorAll("input[name=rcv-pay]")][1]; cash.click()
  await new Promise((r) => setTimeout(r, 200))
  const setItem = Storage.prototype.setItem
  Storage.prototype.setItem = function (k, v) { if (k === "lebanonpos.supplier-payments.v1") throw new DOMException("quota", "QuotaExceededError"); return setItem.call(this, k, v) }
  const b = [...document.querySelectorAll("button")].find((x) => /^(Save delivery|حفظ الشحنة)/.test(x.textContent.trim())); b.click()
  await new Promise((r) => setTimeout(r, 1500))
  Storage.prototype.setItem = setItem
  return "outcomes: " + ([...document.querySelectorAll(".mg2-outcomes > div")].map((d) => d.textContent.trim().slice(0, 70)).join(" | ") || "none") + "; banners: " + [...document.querySelectorAll(".mg2-banner")].map((x) => x.textContent.trim().slice(0, 50)).join(" || ")`, 300]
const recReview = ["open Review what was saved", `const b = __t.textBtn(/Review what was saved|مراجعة ما حُفظ/); b.click(); await new Promise((r) => setTimeout(r, 900)); const d = document.querySelector("[role=dialog]"); if (!d) return "NO drawer"; const rows = [...d.querySelectorAll("tbody tr")].map((r) => [...r.querySelectorAll("td")].map((c) => c.textContent.trim().slice(0, 40)).join(" / ")); const btn = (re) => { const x = [...d.querySelectorAll("button")].find((y) => re.test(y.textContent)); return x ? (x.disabled ? "disabled" : "enabled") : "absent" }; return "rows: " + rows.join(" | ") + "; supplier: " + [...d.querySelectorAll(".mg2-card")].slice(0, 2).map((c) => c.textContent.trim().slice(0, 50)).join(" | ") + "; ops: " + [...d.querySelectorAll("li")].slice(0, 6).map((l) => l.textContent.trim().slice(0, 40)).join(" | ") + "; Complete " + btn(/^(Complete|إكمال)/) + ", Undo " + btn(/^(Undo|التراجع)/) + "; reasons: " + [...d.querySelectorAll(".mg2-card ul li")].map((l) => l.textContent.trim().slice(0, 70)).filter((x) => !/Count the|Check their|Check the supplier|اجرد|راجع/.test(x)).join(" | ")`, 200]
const recComplete = ["press Complete the delivery", `const d = document.querySelector("[role=dialog]"); const b = [...d.querySelectorAll("button")].find((y) => /^(Complete|إكمال)/.test(y.textContent)); b.click(); await new Promise((r) => setTimeout(r, 1500)); const ps = await import("/src/features/pos/services/product.service.ts"); const ib = await import("/src/features/pos/services/inventoryBatch.service.ts"); const sup = await import("/src/features/pos/services/supplier.service.ts"); const p = (await ps.getProducts()).find((x) => x.name === "Pepsi Can"); return "drawer " + (document.querySelector("[role=dialog]") ? "open" : "closed") + "; alerts " + document.querySelectorAll(".mg2-banner.mg2-t-err").length + "; Pepsi stock " + p.stock + "; Pepsi lots " + ib.getInventoryBatches().filter((x) => x.productId === p.id).map((x) => x.initialQuantity).join("+") + "; POs " + sup.getPurchaseOrders().length + "; payments " + sup.getSupplierPayments().length + "; rows " + document.querySelectorAll("tr[data-row]").length`, 200]
const recRetryPay = ["press Retry payment", `const b = __t.textBtn(/Retry payment|إعادة تسجيل الدفع/); b.click(); await new Promise((r) => setTimeout(r, 900)); const sup = await import("/src/features/pos/services/supplier.service.ts"); return "payments " + sup.getSupplierPayments().length + "; PO " + sup.getPurchaseOrders().map((o) => o.poNumber + " " + o.paymentStatus).join(", ") + "; banners: " + [...document.querySelectorAll(".mg2-banner")].map((x) => x.textContent.trim().slice(0, 60)).join(" || ")`, 200]
// Lot details drawer: a lot with a received entry and a damaged-stock adjustment, opened from the list.
const lotSetup = ["adjust the Pepsi lot", `
  const ps = await import("/src/features/pos/services/product.service.ts")
  const ib = await import("/src/features/pos/services/inventoryBatch.service.ts")
  const adj = await import("/src/features/pos/services/inventoryAdjustment.service.ts")
  const p = (await ps.getProducts()).find((x) => x.name === "Pepsi Can")
  const lot = ib.getInventoryBatches().find((b) => b.productId === p.id)
  adj.recordStockAdjustment({ productId: p.id, quantityChange: -2, reason: "Damage", batchId: lot.id, note: "Dented cans" })
  return "lot " + lot.batchNumber + " now " + ib.getInventoryBatches().find((b) => b.id === lot.id).quantityRemaining`, 300]
const openLot = ["open the Pepsi lot", `const b = [...document.querySelectorAll("tr button.mg2-sort")].find((x) => /Pepsi/.test(x.textContent)); b.click(); await new Promise((r) => setTimeout(r, 600)); const d = document.querySelector("[role=dialog]"); return d ? "drawer: " + d.querySelector("h2")?.textContent + "; trace rows " + d.querySelectorAll("tbody tr").length + ": " + [...d.querySelectorAll("tbody tr")].map((r) => r.textContent.trim().slice(0, 60)).join(" | ") : "NO drawer"`, 300]
const STOCK = [
  ["products.en.dark.desktop", { w: 1440, h: 900, path: "/products", steps: [seedStock, reloadStep] }],
  ["products.ar.light.desktop", { w: 1440, h: 900, path: "/products", theme: "light", lang: "ar", steps: [seedStock, reloadStep] }],
  ["products.en.dark.mobile", { w: 390, h: 844, mobile: true, path: "/products", steps: [seedStock, reloadStep] }],
  ["lots.en.dark.desktop", { w: 1440, h: 900, path: "/stock", steps: [seedStock, reloadStep] }],
  ["lots.en.dark.mobile", { w: 390, h: 844, mobile: true, path: "/stock", steps: [seedStock, reloadStep] }],
  ["receiving.en.dark.desktop", { w: 1440, h: 900, path: "/products/new", steps: [] }],
  ["receiving.ar.dark.desktop", { w: 1440, h: 900, path: "/products/new", lang: "ar", steps: [] }],
  ["receiving.en.dark.mobile", { w: 390, h: 844, mobile: true, path: "/products/new", steps: [] }],
  ["receiving-problems.en.dark.desktop", { w: 1440, h: 900, path: "/products/new", steps: RCV_FLOW }],
  ["receiving-saved.en.dark.desktop", { w: 1440, h: 900, path: "/products/new", steps: [...RCV_FLOW, rcvReadyOnly, rcvStock("after"), rcvSaveAgain, rcvStock("after second Save")] }],
  ["receiving-draft.en.dark.desktop", { w: 1440, h: 900, path: "/products/new", steps: [...RCV_FLOW, reloadStep, rcvDraft] }],
  ["products-flow.en.dark.desktop", { w: 1440, h: 900, path: "/products", steps: [seedStock, reloadStep, prodSearch("pep"), prodSearch(""), prodChip("/Expiring|قارب/"), prodChip("/(All|الكل)[0-9]/"), prodBulkArchive] }],
  ["products-editor.en.dark.desktop", { w: 1440, h: 900, path: "/products", steps: [prodEditorEmpty] }],
  ["products-edit.en.dark.desktop", { w: 1440, h: 900, path: "/products", steps: [seedStock, reloadStep, prodDetail("Pepsi Can"), ["press Edit", `document.querySelector("[role=dialog] .mg2-btn-primary").click(); await new Promise((r) => setTimeout(r, 600)); const d = [...document.querySelectorAll("[role=dialog]")].at(-1); return d.querySelector("h2,h3")?.textContent + "; fields " + d.querySelectorAll("input,select,textarea").length`, 50]] }],
  ["products-edit.ar.dark.mobile", { w: 390, h: 844, mobile: true, lang: "ar", path: "/products", steps: [seedStock, reloadStep, prodDetail("Pepsi Can"), ["press Edit", `document.querySelector("[role=dialog] .mg2-btn-primary").click(); await new Promise((r) => setTimeout(r, 600)); const d = [...document.querySelectorAll("[role=dialog]")].at(-1); return d.querySelector("h2,h3")?.textContent + "; fields " + d.querySelectorAll("input,select,textarea").length`, 50]] }],
  ["products-detail.en.dark.desktop", { w: 1440, h: 900, path: "/products", steps: [seedStock, reloadStep, prodDetail("Pepsi Can")] }],
  ["products-detail-fresh.en.dark.desktop", { w: 1440, h: 900, path: "/products", steps: [prodDetail("Cheese Saj"), ["Cheese Saj history", `const ps = await import("/src/features/pos/services/product.service.ts"); const p = (await ps.getProducts()).find((x) => x.name === "Cheese Saj"); return JSON.stringify(ps.getProductHistory(p.id))`, 50], ["new product: create + open", `const ps = await import("/src/features/pos/services/product.service.ts"); await ps.createProduct({ name: "QA Fresh Item", barcode: "6291000555001", category: "Snacks", price: 1, cost: 0.5, stock: 0 }); return "created"`, 300], reloadStep, prodDetail("QA Fresh Item")] }],
  ["products-cashier.en.dark.desktop", { w: 1440, h: 900, path: "/products", setup: asCashier, steps: [prodEditorEmpty, prodBulkArchive] }],
  ["lots-cashier.en.dark.desktop", { w: 1440, h: 900, path: "/stock", setup: asCashier, steps: [seedStock, reloadStep, ["header actions", `return [...document.querySelectorAll("main a, main button")].slice(0, 6).map((x) => x.textContent.trim() || x.getAttribute("aria-label")).join(" | ")`, 50]] }],
  ["receiving-recovered.en.dark.desktop", { w: 1440, h: 900, path: "/products/new", steps: [recSetup("a finished save"), reloadStep, recState, recRetry] }],
  ["receiving-unknown.en.dark.desktop", { w: 1440, h: 900, path: "/products/new", steps: [recSetup("the lots failing"), reloadStep, recState] }],
  ["receiving-review.en.dark.desktop", { w: 1440, h: 900, path: "/products/new", steps: [recSetup("the lots failing"), reloadStep, recReview] }],
  ["receiving-review.ar.dark.mobile", { w: 390, h: 844, mobile: true, lang: "ar", path: "/products/new", steps: [recSetup("the lots failing"), reloadStep, recReview] }],
  ["receiving-review-blocked.en.dark.desktop", { w: 1440, h: 900, path: "/products/new", steps: [recSetup("the queue failing"), reloadStep, recReview] }],
  ["receiving-review-receiver.en.dark.desktop", { w: 1440, h: 900, path: "/products/new", setup: asReceiver, steps: [recSetup("the lots failing"), reloadStep, recReview] }],
  ["receiving-review-completed.en.dark.desktop", { w: 1440, h: 900, path: "/products/new", steps: [recSetup("the lots failing"), reloadStep, recReview, recComplete] }],
  ["receiving-payment-failed.en.dark.desktop", { w: 1440, h: 900, path: "/products/new", steps: [recSetup("the payment failing"), reloadStep, recState] }],
  ["receiving-payment-failed.ar.light.mobile", { w: 390, h: 844, mobile: true, theme: "light", lang: "ar", path: "/products/new", steps: [recSetup("the payment failing"), reloadStep, recState] }],
  ["receiving-ui-payment-failed.en.dark.desktop", { w: 1440, h: 900, path: "/products/new", steps: [uiSupplier, reloadStep, rcvStock("before"), rcvScan("PEPSI"), rcvScan("PEPSI"), uiSaveCashPaymentFails, rcvStock("after")] }],
  ["receiving-ui-payment-failed.ar.dark.mobile", { w: 390, h: 844, mobile: true, lang: "ar", path: "/products/new", steps: [uiSupplier, reloadStep, rcvStock("before"), rcvScan("PEPSI"), uiSaveCashPaymentFails] }],
  ["receiving-toast.en.dark.desktop", { w: 1440, h: 900, path: "/products/new", steps: [uiSupplier, reloadStep, rcvStock("before"), rcvScan("PEPSI"), rcvScan("PEPSI"), uiSaveCashPaymentFails, ["fire a temporary toast (Print labels)", `const b = __t.textBtn(/^(Print labels|طباعة الملصقات)/); b.click(); await new Promise((r) => setTimeout(r, 400)); const ts = [...document.querySelectorAll("[aria-live=polite] [role=alert]")]; const ctl = [...document.querySelectorAll("button, a, input, select, textarea")].filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.height && getComputedStyle(e).visibility !== "hidden" && !e.closest("[aria-live=polite]") }); const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom; const over = ts.flatMap((t) => ctl.filter((c) => hit(t.getBoundingClientRect(), c.getBoundingClientRect())).map((c) => (c.textContent.trim() || c.getAttribute("aria-label") || c.tagName).slice(0, 30))); return "toasts " + ts.length + " [" + ts.map((t) => t.textContent.trim()).join(" | ") + "]; pointer-events " + ts.map((t) => getComputedStyle(t).pointerEvents).join(",") + "; controls under a toast: " + (over.join(", ") || "none")`, 50]] }],
  ["receiving-toast.ar.dark.mobile", { w: 390, h: 844, mobile: true, lang: "ar", path: "/products/new", steps: [uiSupplier, reloadStep, rcvStock("before"), rcvScan("PEPSI"), uiSaveCashPaymentFails, ["fire a temporary toast (Print labels)", `const b = __t.textBtn(/^(Print labels|طباعة الملصقات)/); b.click(); await new Promise((r) => setTimeout(r, 400)); const ts = [...document.querySelectorAll("[aria-live=polite] [role=alert]")]; const ctl = [...document.querySelectorAll("button, a, input, select, textarea")].filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.height && getComputedStyle(e).visibility !== "hidden" && !e.closest("[aria-live=polite]") }); const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom; const over = ts.flatMap((t) => ctl.filter((c) => hit(t.getBoundingClientRect(), c.getBoundingClientRect())).map((c) => (c.textContent.trim() || c.getAttribute("aria-label") || c.tagName).slice(0, 30))); return "toasts " + ts.length + " [" + ts.map((t) => t.textContent.trim()).join(" | ") + "]; pointer-events " + ts.map((t) => getComputedStyle(t).pointerEvents).join(",") + "; controls under a toast: " + (over.join(", ") || "none")`, 50]] }],
  ["pos-toast.en.dark.mobile", { w: 390, h: 844, mobile: true, path: "/", steps: [["fire a temporary toast", `const url = performance.getEntriesByType("resource").map((e) => e.name).find((n) => n.includes("toast.service")); (await import(url)).showToast("Layout check", "success"); await new Promise((r) => setTimeout(r, 700)); const t = document.querySelector("[aria-live=polite] [role=alert]").getBoundingClientRect(); const bar = document.querySelector(".mg2-paybar")?.getBoundingClientRect(); const ctl = [...document.querySelectorAll("button, a, input, select, textarea")].filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.height && !e.closest("[aria-live=polite]") }); const vis = (e) => { const r = e.getBoundingClientRect(); let o = { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; for (let p = e.parentElement; p; p = p.parentElement) { const c = getComputedStyle(p); if (c.overflowY !== "visible" || c.overflowX !== "visible") { const k = p.getBoundingClientRect(); o = { left: Math.max(o.left, k.left), top: Math.max(o.top, k.top), right: Math.min(o.right, k.right), bottom: Math.min(o.bottom, k.bottom) } } } return o }; const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom; return "toast " + Math.round(t.top) + "-" + Math.round(t.bottom) + "; paybar " + (bar ? Math.round(bar.top) + "-" + Math.round(bar.bottom) : "none") + "; controls under the toast: " + (ctl.filter((c) => hit(t, vis(c))).map((c) => (c.textContent.trim() || c.getAttribute("aria-label") || c.tagName).slice(0, 24)).join(", ") || "none")`, 50]] }],
  ["pos-toast.en.dark.tablet", { w: 820, h: 1180, path: "/", steps: [["fire a temporary toast", `const url = performance.getEntriesByType("resource").map((e) => e.name).find((n) => n.includes("toast.service")); (await import(url)).showToast("Layout check", "success"); await new Promise((r) => setTimeout(r, 700)); const t = document.querySelector("[aria-live=polite] [role=alert]").getBoundingClientRect(); const bar = document.querySelector(".mg2-paybar")?.getBoundingClientRect(); const ctl = [...document.querySelectorAll("button, a, input, select, textarea")].filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.height && !e.closest("[aria-live=polite]") }); const vis = (e) => { const r = e.getBoundingClientRect(); let o = { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; for (let p = e.parentElement; p; p = p.parentElement) { const c = getComputedStyle(p); if (c.overflowY !== "visible" || c.overflowX !== "visible") { const k = p.getBoundingClientRect(); o = { left: Math.max(o.left, k.left), top: Math.max(o.top, k.top), right: Math.min(o.right, k.right), bottom: Math.min(o.bottom, k.bottom) } } } return o }; const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom; return "toast " + Math.round(t.top) + "-" + Math.round(t.bottom) + "; paybar " + (bar ? Math.round(bar.top) + "-" + Math.round(bar.bottom) : "none") + "; controls under the toast: " + (ctl.filter((c) => hit(t, vis(c))).map((c) => (c.textContent.trim() || c.getAttribute("aria-label") || c.tagName).slice(0, 24)).join(", ") || "none")`, 50]] }],
  ["pos-toast.en.dark.desktop", { w: 1440, h: 900, path: "/", steps: [["fire a temporary toast", `const url = performance.getEntriesByType("resource").map((e) => e.name).find((n) => n.includes("toast.service")); (await import(url)).showToast("Layout check", "success"); await new Promise((r) => setTimeout(r, 700)); const t = document.querySelector("[aria-live=polite] [role=alert]").getBoundingClientRect(); const bar = document.querySelector(".mg2-paybar")?.getBoundingClientRect(); const ctl = [...document.querySelectorAll("button, a, input, select, textarea")].filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.height && !e.closest("[aria-live=polite]") }); const vis = (e) => { const r = e.getBoundingClientRect(); let o = { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; for (let p = e.parentElement; p; p = p.parentElement) { const c = getComputedStyle(p); if (c.overflowY !== "visible" || c.overflowX !== "visible") { const k = p.getBoundingClientRect(); o = { left: Math.max(o.left, k.left), top: Math.max(o.top, k.top), right: Math.min(o.right, k.right), bottom: Math.min(o.bottom, k.bottom) } } } return o }; const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom; return "toast " + Math.round(t.top) + "-" + Math.round(t.bottom) + "; paybar " + (bar ? Math.round(bar.top) + "-" + Math.round(bar.bottom) : "none") + "; controls under the toast: " + (ctl.filter((c) => hit(t, vis(c))).map((c) => (c.textContent.trim() || c.getAttribute("aria-label") || c.tagName).slice(0, 24)).join(", ") || "none")`, 50]] }],
  ["receiving-payment-retried.en.dark.desktop", { w: 1440, h: 900, path: "/products/new", steps: [recSetup("the payment failing"), reloadStep, recRetryPay] }],
  ["receiving-unknown.ar.dark.mobile", { w: 390, h: 844, mobile: true, lang: "ar", path: "/products/new", steps: [recSetup("the lots failing"), reloadStep, recState] }],
  ["lot-drawer.en.dark.desktop", { w: 1440, h: 900, path: "/stock", steps: [seedStock, lotSetup, reloadStep, openLot] }],
  ["lot-drawer.ar.dark.mobile", { w: 390, h: 844, mobile: true, lang: "ar", path: "/stock", steps: [seedStock, lotSetup, reloadStep, openLot] }],
  ["lot-drawer.ar.light.desktop", { w: 1440, h: 900, theme: "light", lang: "ar", path: "/stock", steps: [seedStock, lotSetup, reloadStep, openLot] }],
  ["products.ar.dark.mobile", { w: 390, h: 844, mobile: true, lang: "ar", path: "/products", steps: [seedStock, reloadStep] }],
  ["receiving-problems.ar.light.mobile", { w: 390, h: 844, mobile: true, theme: "light", lang: "ar", path: "/products/new", steps: RCV_FLOW }],
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
    for (const [name, opts] of (process.env.QA_STOCK ? STOCK : process.env.QA_FIVE ? FIVE : process.env.QA_PAY ? PAY : process.env.QA_RECEIPT ? RECEIPT : process.env.QA_REVIEW ? REVIEW : process.env.QA_NAMES ? NAMES : process.env.QA_SHELL ? SHELL : process.env.SHIFT ? SHIFT : process.env.BEHAVIOUR ? BEHAVIOUR : process.env.MORE ? MORE : [...SCENES, ...MORE, ...SHIFT, ...SHELL, ...NAMES])) if (!only || only.test(name)) { results.push(await scene(cdp, name, opts)); console.log(name, JSON.stringify(results.at(-1).log.map(([l, v]) => `${l}: ${v}`)), JSON.stringify(results.at(-1).facts)) }
    fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify({ base: BASE, at: new Date().toISOString(), results }, null, 2))
  } finally { chrome.kill() }
})().catch((e) => { console.error(e); process.exit(1) })
