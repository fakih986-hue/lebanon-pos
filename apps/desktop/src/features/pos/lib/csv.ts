/** Download rows as CSV (UTF-8 with BOM so Arabic opens correctly in spreadsheets). */
export function downloadCsv(filename: string, header: string[], rows: Array<Array<string | number>>) {
  const cell = (v: string | number) => {
    const s = String(v ?? "")
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const csv = "﻿" + [header, ...rows].map((r) => r.map(cell).join(",")).join("\n")
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }))
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
