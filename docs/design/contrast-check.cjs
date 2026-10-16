// WCAG 2.x contrast of every text/background token pair used by the design
// system, both themes. Soft status tints are alpha-blended over the surface they
// sit on (as rendered). Writes docs/design/qa/contrast.json and prints a table.
const fs = require("fs")
const path = require("path")

const themes = {
  dark: {
    "page-bg": "#0B0E14", surface: "#12161F", "surface-2": "#171C27", "surface-3": "#1E2430", rail: "#05070D",
    text: "#F4F6FA", "text-2": "#9AA4B8", "text-3": "#7C879B", brand: "#D4A843", "brand-text": "#E4BC5C", "brand-contrast": "#2C1F05", "rail-text": "#C4CBD8",
    ok: "#34D399", warn: "#FBBF24", err: "#F87171", info: "#60A5FA",
    "ok-soft": [52, 211, 153, 0.12], "warn-soft": [251, 191, 36, 0.12], "err-soft": [248, 113, 113, 0.12], "info-soft": [96, 165, 250, 0.12], "brand-soft": [212, 168, 67, 0.12],
  },
  light: {
    "page-bg": "#F7F5F1", surface: "#FFFFFF", "surface-2": "#F6F4EF", "surface-3": "#ECE8E1", rail: "#05070D",
    text: "#1C1917", "text-2": "#57534E", "text-3": "#635D55", brand: "#996d14", "brand-text": "#6B4C0A", "brand-contrast": "#FFFFFF", "rail-text": "#C4CBD8",
    ok: "#137639", warn: "#a44c09", err: "#b91c1c", info: "#0e6d93",
    "ok-soft": [22, 163, 74, 0.10], "warn-soft": [180, 83, 9, 0.10], "err-soft": [220, 38, 38, 0.09], "info-soft": [14, 122, 165, 0.10], "brand-soft": [156, 111, 20, 0.10],
  },
}
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
const L = (rgb) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2])
const ratio = (a, b) => { const x = L(a), y = L(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
const resolve = (t, spec, over = "surface") => {
  const [name, on] = spec.split("@")
  if (on) over = on
  const v = t[name]
  if (Array.isArray(v)) { const base = hex(t[over]); return v.slice(0, 3).map((c, i) => c * v[3] + base[i] * (1 - v[3])) }
  return hex(v)
}
// [label, fg, bg, need] — need 4.5 for body text, 3 for large/bold (≥24px or ≥18.66px bold) and UI.
const pairs = [
  ["Body text on page", "text", "page-bg", 4.5], ["Body text on surface", "text", "surface", 4.5],
  ["Secondary text on surface", "text-2", "surface", 4.5], ["Secondary text on inset", "text-2", "surface-2", 4.5],
  ["Meta text on surface", "text-3", "surface", 4.5], ["Meta text on inset", "text-3", "surface-2", 4.5], ["Meta text on page", "text-3", "page-bg", 4.5],
  ["Text on gold button", "brand-contrast", "brand", 4.5], ["Gold text (chips) on gold tint", "brand-text", "brand-soft", 4.5],
  ["Gold focus ring / indicator vs surface (UI)", "brand", "surface", 3],
  ["Success text on success tint", "ok", "ok-soft", 4.5], ["Warning text on warning tint", "warn", "warn-soft", 4.5],
  ["Error text on error tint", "err", "err-soft", 4.5], ["Info text on info tint", "info", "info-soft", 4.5],
  ["Error text on surface", "err", "surface", 4.5],
  // Tints also sit on the page background and on insets: check the worst case.
  ["Success text on tint over page", "ok", "ok-soft@page-bg", 4.5], ["Warning text on tint over page", "warn", "warn-soft@page-bg", 4.5],
  ["Error text on tint over page", "err", "err-soft@page-bg", 4.5], ["Info text on tint over page", "info", "info-soft@page-bg", 4.5],
  ["Warning text on tint over inset", "warn", "warn-soft@surface-2", 4.5], ["Gold text on tint over page", "brand-text", "brand-soft@page-bg", 4.5],
  ["Sidebar text on rail", "rail-text", "rail", 4.5],
]
const out = {}
for (const [name, t] of Object.entries(themes)) {
  out[name] = pairs.map(([label, fg, bg, need]) => {
    const r = Math.round(ratio(resolve(t, fg), resolve(t, bg)) * 100) / 100
    return { label, fg, bg, ratio: r, need, pass: r >= need }
  })
}
fs.mkdirSync(path.join(__dirname, "qa"), { recursive: true })
fs.writeFileSync(path.join(__dirname, "qa", "contrast.json"), JSON.stringify(out, null, 2))
for (const [name, rows] of Object.entries(out)) {
  console.log(`\n${name.toUpperCase()}`)
  for (const r of rows) console.log(`${r.pass ? "PASS" : "FAIL"}  ${String(r.ratio).padStart(5)} : 1  (need ${r.need})  ${r.label}`)
}
