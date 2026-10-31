// Refused work a manager DECLINED (the server answers DISMISSED): the register keeps showing what
// already happened locally — nothing is undone automatically — until someone records what was done.
import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { beforeEach, describe, expect, it } from "vitest"
import { I18nProvider } from "@lebanonpos/shared"

const QUEUE = "lebanonpos.sync-queue.v1"
const decision = 'DISMISSED: declined by Sami on review ("miscounted"). The server did not apply operation op-1; nothing this register already did (stock changed, cash paid out or taken) was undone - correct it on this register if needed.'
const ops = [
  { id: "op-adj", entity: "inventory", action: "adjust", summary: "Milk 1L stock adjustment queued for sync.", payload: { id: "a1", productName: "Milk 1L", quantityChange: 5 }, status: "Rejected", attempts: 5, createdAt: "2026-10-31T08:00:00.000Z", error: decision },
  { id: "op-exp", entity: "expense", action: "create", summary: "Expense EXP-1", payload: { id: "e1", amount: 12.5 }, status: "Rejected", attempts: 5, createdAt: "2026-10-31T08:01:00.000Z", error: decision.replace("op-1", "op-2") },
  { id: "op-other", entity: "inventory", action: "adjust", summary: "x", payload: {}, status: "Rejected", attempts: 5, createdAt: "2026-10-31T08:02:00.000Z", error: "Insufficient stock" },
]

async function render() {
  const { default: DeclinedWork } = await import("../components/layout/DeclinedWork")
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => { root.render(createElement(I18nProvider, null, createElement(DeclinedWork))) })
  return host
}
const type = async (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
  await act(async () => { setter.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })) })
}

beforeEach(async () => {
  localStorage.clear()
  document.body.innerHTML = ""
  const { hashPin } = await import("../features/pos/services/security.service")
  localStorage.setItem("lebanonpos.users.v1", JSON.stringify([{ id: "rana", name: "Rana", role: "Cashier", pin: await hashPin("2222"), active: true, permissions: [], pinVersion: 1, lastVerifiedPinVersion: 1 }]))
  localStorage.setItem("lebanonpos.current-user.v1", "rana")
  localStorage.setItem(QUEUE, JSON.stringify(ops))
})

describe("declined work on the register", () => {
  it("shows each declined item with what already happened here, the decision, and that nothing was undone", async () => {
    const host = await render()
    const panel = host.querySelector('[data-testid="declined-work"]')!
    expect(panel).not.toBeNull()
    const text = panel.textContent ?? ""
    expect(text).toContain("Milk 1L +5")
    expect(text).toContain("does not include this change")
    expect(text).toContain("12.50")
    expect(text).toContain("not returned by the decision")
    expect(text).toContain('declined by Sami on review ("miscounted")')
    expect(text).toContain("were NOT undone automatically")
    expect(text).not.toContain("Insufficient stock") // only manager-declined items are listed here
  })

  it("stays until someone records what was done (a note is required); handling is audited, nothing is reversed", async () => {
    const host = await render()
    const firstButton = () => host.querySelectorAll('[data-testid="declined-work"] button')[0] as HTMLButtonElement
    await act(async () => { firstButton().click() })
    expect(host.textContent).toContain("Write what was done")
    expect(JSON.parse(localStorage.getItem(QUEUE)!).map((o: { id: string }) => o.id)).toContain("op-adj")
    await type(host.querySelectorAll('[data-testid="declined-work"] input')[0] as HTMLInputElement, "counted the shelf: 15, recorded a correction")
    await act(async () => { firstButton().click() })
    const queue = JSON.parse(localStorage.getItem(QUEUE)!) as Array<{ id: string }>
    expect(queue.map((o) => o.id)).toEqual(["op-exp", "op-other"])
    const audit = JSON.parse(localStorage.getItem("lebanonpos.audit.v1") ?? "[]") as Array<{ action: string; summary: string }>
    expect(audit.some((a) => a.action === "sync.declined.handled" && a.summary.includes("counted the shelf"))).toBe(true)
  })
})
