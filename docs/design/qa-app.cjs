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
          // Enter carries its text so the browser performs the default action (e.g. activating a focused button), as a real keyboard does.
          for (const type of [key === "Enter" ? "keyDown" : "rawKeyDown", "keyUp"]) await cdp.send("Input.dispatchKeyEvent", { type, key, code: key, windowsVirtualKeyCode: codes[key], modifiers: shift ? 8 : 0, ...(key === "Enter" && type === "keyDown" ? { text: "\r", unmodifiedText: "\r" } : {}) }, sessionId)
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
    for (const [name, opts] of (process.env.QA_RECEIPT ? RECEIPT : process.env.QA_REVIEW ? REVIEW : process.env.QA_NAMES ? NAMES : process.env.QA_SHELL ? SHELL : process.env.SHIFT ? SHIFT : process.env.BEHAVIOUR ? BEHAVIOUR : process.env.MORE ? MORE : [...SCENES, ...MORE, ...SHIFT, ...SHELL, ...NAMES])) if (!only || only.test(name)) { results.push(await scene(cdp, name, opts)); console.log(name, JSON.stringify(results.at(-1).log.map(([l, v]) => `${l}: ${v}`)), JSON.stringify(results.at(-1).facts)) }
    fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify({ base: BASE, at: new Date().toISOString(), results }, null, 2))
  } finally { chrome.kill() }
})().catch((e) => { console.error(e); process.exit(1) })
