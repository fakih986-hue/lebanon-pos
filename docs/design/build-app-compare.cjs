// Builds docs/design/qa/app-compare.html from the qa-app.cjs runs:
//   before = docs/design/qa/app-before (v1), after = docs/design/qa/app-after (v2, with report.json).
// Run: node docs/design/build-app-compare.cjs
const fs = require("fs")
const path = require("path")
const dir = path.resolve(__dirname, "qa")
const report = JSON.parse(fs.readFileSync(path.join(dir, "app-after", "report.json"), "utf8"))
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c])
// Scenes that had no v1 equivalent: say why instead of showing a mismatched picture.
const NO_BEFORE = {
  shift: "Not possible in v1 below 1024 px: the Cash Drawer lived only in the desktop cart rail, so a phone or tablet could not open a shift.",
}
const sections = report.results.map((r) => {
  // Shell scenes compare against the capture taken just before the top-bar fix (app-before-shell), not v1.
  const fixDir = r.name.startsWith("shell-") && fs.existsSync(path.join(dir, "app-before-shell", `${r.name}.png`)) ? "app-before-shell" : null
  const beforeDir = fixDir ?? "app-before"
  const before = path.join(dir, beforeDir, `${r.name}.png`)
  const key = Object.keys(NO_BEFORE).find((k) => r.name.startsWith(k))
  const left = fs.existsSync(before)
    ? `<figure><figcaption>${fixDir ? "Before the top-bar fix" : "Before (v1)"}</figcaption><img src="${beforeDir}/${r.name}.png" alt="before ${esc(r.name)}"></figure>`
    : `<figure class="none"><figcaption>Before (v1)</figcaption><p>${esc(key ? NO_BEFORE[key] : "No v1 capture for this scene.")}</p></figure>`
  const steps = r.log.map(([l, v]) => `<li><b>${esc(l)}</b>: ${esc(v)}</li>`).join("")
  return `<section><h2>${esc(r.name)} <small>${r.w}×${r.h}</small></h2><div class="pair">${left}<figure><figcaption>After (v2) · focus: ${esc(r.facts.active ?? "none")}${r.facts.overflowX ? " · HORIZONTAL OVERFLOW" : ""}</figcaption><img src="app-after/${r.name}.png" alt="after ${esc(r.name)}"></figure></div><details><summary>Scripted steps and results</summary><ol>${steps}</ol></details></section>`
})
const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Register slice: before / after</title><style>body{font-family:system-ui;background:#0B0E14;color:#F4F6FA;margin:24px}h1{font-size:20px}h2{font-size:15px;margin:28px 0 8px}h2 small{color:#9AA4B8;font-weight:400}.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start}figure{margin:0;background:#12161F;border:1px solid #1E2430;border-radius:10px;padding:8px}figure.none p{color:#9AA4B8;font-size:14px;line-height:1.5;padding:8px}img{width:100%;border-radius:6px}figcaption{font-size:12px;color:#9AA4B8;margin-bottom:6px}details{font-size:12px;color:#9AA4B8;margin-top:6px}li{margin:2px 0}</style></head><body><h1>Register slice: running app, v1 → Midnight Gold v2</h1><p>Vite dev server, local dev mode (no API), the same scripted cashier steps, each scene in a fresh browser profile at its own viewport from the first paint. Generated ${esc(report.at)}. Regenerate: <code>node docs/design/qa-app.cjs docs/design/qa/app-after</code>, then <code>node docs/design/build-app-compare.cjs</code>.</p>${sections.join("\n")}</body></html>`
fs.writeFileSync(path.join(dir, "app-compare.html"), html)
console.log(`app-compare.html: ${report.results.length} scenes`)
