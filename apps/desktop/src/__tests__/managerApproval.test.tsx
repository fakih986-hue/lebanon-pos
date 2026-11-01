// SPRINT-2 E: the manager approval dialog as people use it — keyboard (focus on the PIN, Enter, Escape,
// focus back to the scanner field), touch keypad, one request at a time, slow server, wrong PIN, shared
// PIN, cancel leaving the work as it was; English and Arabic. And the register's approval grants:
// in memory, one record, the person signed in, cleared with the person.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, createElement as h } from "react"
import { createRoot, type Root } from "react-dom/client"
import { I18nProvider } from "@lebanonpos/shared"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Pending = { resolve: (v: unknown) => void; req: any; signal?: AbortSignal }
const calls: Pending[] = []
vi.mock("../features/pos/services/approval.service", () => ({
  requestManagerApproval: (req: any, opts: { signal?: AbortSignal } = {}) => new Promise((resolve) => { calls.push({ resolve, req, signal: opts.signal }) }),
}))

import ManagerApprovalDialog from "../components/ManagerApprovalDialog"
import { addApprovalGrant, approvalGrantFor, clearApprovalGrants, pendingApprovalCount, takeApprovalGrant } from "../features/pos/lib/approvalGrants"
import { clearPersonEvidence } from "../features/pos/lib/deviceCredentials"

let container: HTMLDivElement, root: Root, scanner: HTMLInputElement
const request = { entity: "refund", action: "create", payload: { id: "r1", total: 5 }, permission: "sales.refund" as const }
const grant = { approvalId: "a1", entity: "refund", action: "create", recordId: "r1", permission: "sales.refund", approverName: "Maya", expiresAt: new Date(Date.now() + 60_000).toISOString(), userId: "rana" }
const flushAsync = () => act(async () => { await new Promise((r) => setTimeout(r, 10)) })
const pinInput = () => document.body.querySelector<HTMLInputElement>("input[type=password]")!
const text = () => document.querySelector("[role=dialog]")?.textContent ?? ""
function type(value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(pinInput(), value)
  pinInput().dispatchEvent(new Event("input", { bubbles: true }))
}
async function render(props: Partial<Parameters<typeof ManagerApprovalDialog>[0]> = {}, lang = "en") {
  localStorage.setItem("lebanonpos.locale", lang)
  const onApproved = vi.fn(), onCancel = vi.fn()
  await act(async () => { root.render(h(I18nProvider, null, h(ManagerApprovalDialog, { open: true, summary: h("p", null, "Refund $5.00 on S-1"), request, onApproved, onCancel, ...props }))) })
  await flushAsync()
  return { onApproved, onCancel }
}

beforeEach(() => {
  calls.length = 0
  localStorage.clear()
  document.body.innerHTML = ""
  scanner = document.createElement("input"); scanner.setAttribute("aria-label", "scanner"); document.body.appendChild(scanner); scanner.focus()
  container = document.createElement("div"); document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); clearApprovalGrants() })

describe("manager approval dialog", () => {
  it("opens with focus on the PIN field; Enter approves once even if pressed again; the grant is handed back", async () => {
    const { onApproved } = await render()
    expect(document.activeElement).toBe(pinInput())
    await act(async () => { type("6602") })
    const form = document.body.querySelector("form")!
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })) })
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })) }) // repeated confirmation
    expect(calls).toHaveLength(1)
    expect(calls[0].req).toMatchObject({ entity: "refund", action: "create", pin: "6602", permission: "sales.refund" })
    expect(text()).toContain("Checking with the server")
    await act(async () => { calls[0].resolve({ ok: true, grant }) })
    expect(onApproved).toHaveBeenCalledWith(grant)
  })

  it("the touch keypad types digits; a slow server is said so; a wrong PIN is shown and the PIN cleared", async () => {
    await render({ slowMs: 20 })
    const key = (d: string) => [...document.body.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === d)!
    await act(async () => { for (const d of ["6", "6", "0", "1"]) key(d).click() })
    expect(pinInput().value).toBe("6601")
    await act(async () => { document.body.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })) })
    await flushAsync(); await flushAsync()
    expect(text()).toContain("Still waiting for the server")
    await act(async () => { calls[0].resolve({ ok: false, code: "INVALID_PIN", message: "Wrong PIN.", remaining: 3 }) })
    expect(text()).toContain("Wrong PIN. 3 attempts left")
    expect(pinInput().value).toBe("")
    expect(document.body.querySelector("[role=alert]")).toBeTruthy()
  })

  it("Escape cancels: nothing is approved, the request in flight is abandoned, focus returns to the scanner field", async () => {
    const { onCancel, onApproved } = await render()
    await act(async () => { type("1234") })
    await act(async () => { document.body.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })) })
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })) })
    expect(onCancel).toHaveBeenCalled()
    expect(calls[0].signal?.aborted).toBe(true)
    await act(async () => { root.render(h(I18nProvider, null, h(ManagerApprovalDialog, { open: false, summary: null, request: null, onApproved, onCancel }))) })
    await flushAsync()
    expect(document.activeElement).toBe(scanner)
    await act(async () => { calls[0].resolve({ ok: true, grant }) })
    expect(onApproved).not.toHaveBeenCalled()
  })

  it("a PIN shared by two people: the person approving is chosen, then the same PIN is sent for them", async () => {
    await render()
    await act(async () => { type("1111") })
    await act(async () => { document.body.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })) })
    await act(async () => { calls[0].resolve({ ok: false, code: "AMBIGUOUS_PIN", message: "", candidates: [{ id: "m1", name: "Maya" }, { id: "m2", name: "Sami" }] }) })
    expect(text()).toContain("Who is approving")
    await act(async () => { [...document.body.querySelectorAll("button")].find((b) => b.textContent === "Sami")!.click() })
    expect(calls[1].req).toMatchObject({ pin: "1111", approverId: "m2" })
  })

  it("opened from inside a drawer (the page behind is inert): the dialog is outside it and its PIN field takes focus", async () => {
    // the page mounts the dialog closed; a Drawer then opens and marks every <body> child inert; then the dialog opens
    const onApproved = vi.fn(), onCancel = vi.fn()
    await act(async () => { root.render(h(I18nProvider, null, h(ManagerApprovalDialog, { open: false, summary: null, request, onApproved, onCancel }))) })
    for (const el of [...document.body.children]) el.setAttribute("inert", "")
    await act(async () => { root.render(h(I18nProvider, null, h(ManagerApprovalDialog, { open: true, summary: h("p", null, "Void"), request, onApproved, onCancel }))) })
    await flushAsync()
    expect(pinInput().closest("[inert]")).toBeNull()
    expect(document.activeElement).toBe(pinInput())
  })

  it("focus stays inside: the review dialog underneath returning focus to the scanner field late (after the PIN took it) brings it back to the PIN", async () => {
    await render()
    expect(document.activeElement).toBe(pinInput())
    // a confirmation closing underneath hands focus back to its trigger after its own exit animation
    await act(async () => { scanner.focus() })
    expect(document.activeElement).toBe(pinInput())
    // digits from a keyboard or a scanner go to the PIN, never into the page behind
    await act(async () => { type("6602") })
    expect([pinInput().value, scanner.value]).toEqual(["6602", ""])
  })

  it("Arabic: the dialog and its errors are translated", async () => {
    await render({}, "ar")
    expect(text()).toContain("موافقة المدير")
    await act(async () => { type("1") })
    await act(async () => { document.body.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })) })
    await act(async () => { calls[0].resolve({ ok: false, code: "OFFLINE", message: "x" }) })
    expect(text()).toContain("لا توجد موافقة دون اتصال")
  })
})

describe("approval grants on the register", () => {
  it("one record, one permission, the person signed in; taken once by the operation; cleared with the person", () => {
    addApprovalGrant(grant)
    expect(approvalGrantFor("refund", "create", "r1", "sales.refund", "rana")).toBeTruthy()
    expect(approvalGrantFor("refund", "create", "r2", "sales.refund", "rana")).toBeNull()
    expect(approvalGrantFor("refund", "create", "r1", "sales.void", "rana")).toBeNull()
    expect(approvalGrantFor("refund", "create", "r1", "sales.refund", "sami")).toBeNull()
    expect(takeApprovalGrant("refund", "create", "r1")?.approvalId).toBe("a1")
    expect(takeApprovalGrant("refund", "create", "r1")).toBeNull()
    addApprovalGrant(grant)
    clearPersonEvidence() // lock or change of person
    expect(pendingApprovalCount()).toBe(0)
    addApprovalGrant({ ...grant, expiresAt: new Date(Date.now() - 1000).toISOString() })
    expect(approvalGrantFor("refund", "create", "r1", "sales.refund", "rana")).toBeNull()
  })
})
