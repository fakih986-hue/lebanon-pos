// Release batch — held work on the register. What the server says an operation waits for decides what the register
// does: a dependency (something not received yet) or a manager's review never uses up attempts and is never marked
// final here; a review is asked about again now and then, so the outcome (applied once, or declined) reaches the
// register. A dropped connection is temporary; a server error counts. Work an earlier version gave up on while it
// only waited is sent again. The operation keeps its original staff session and actor whoever signs in meanwhile.
// A caller asking for a send while one is under way gets one that includes its operation.
import { beforeEach, describe, expect, it, vi } from "vitest"

const QUEUE = "lebanonpos.sync-queue.v1"
const op = (id: string, over: Record<string, unknown> = {}) => ({ id, entity: "inventory", action: "adjust", summary: `adjust ${id}`, payload: { id: `adj-${id}` }, status: "Pending", attempts: 0, createdAt: "2026-11-02T10:00:00.000Z", ...over })
const queue = () => JSON.parse(localStorage.getItem(QUEUE)!) as Array<Record<string, any>>
const byId = (id: string) => queue().find((o) => o.id === id)!
let pushes: Array<string[]> = []
function server(answer: (id: string) => Record<string, unknown> | "drop" | number) {
  pushes = []
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    if (!String(url).includes("/api/sync/push")) return new Response(JSON.stringify({ ok: true }), { status: 200 })
    const ops = (JSON.parse(String(init.body)).operations as Array<{ id: string }>).map((o) => o.id)
    pushes.push(ops)
    const answers = ops.map(answer)
    if (answers.includes("drop")) throw new TypeError("Failed to fetch")
    const status = answers.find((a) => typeof a === "number") as number | undefined
    if (status) return new Response("{}", { status })
    return new Response(JSON.stringify({ results: answers.map((a, i) => ({ id: ops[i], ...(a as object) })) }), { status: 200 })
  }))
}

beforeEach(() => {
  vi.resetModules()
  vi.unstubAllGlobals()
  localStorage.clear()
  localStorage.setItem("lebanonpos.api-url", "http://hub.test")
  localStorage.setItem("lebanonpos.auth-token", "t")
})

describe("what the server says it waits for", () => {
  it("a dependency (a product not received yet): kept, attempts not used up, listed as waiting; applied once it arrives", async () => {
    localStorage.setItem(QUEUE, JSON.stringify([op("a", { attempts: 4 })]))
    let arrived = false
    server(() => (arrived ? { status: "ok" } : { status: "error", kind: "dependency", error: 'PRODUCT_PENDING: "Oat milk" has not reached this server yet' }))
    const s = await import("../features/pos/services/sync.service")
    for (let i = 0; i < 6; i++) { await s.flushSyncQueue(); localStorage.setItem(QUEUE, JSON.stringify(queue().map((o) => ({ ...o, lastAttemptAt: "2000-01-01T00:00:00.000Z" })))) }
    expect(byId("a")).toMatchObject({ status: "Failed", held: "dependency", attempts: 4 })
    expect(s.getWaitingWork().map((w) => [w.operationId, w.state])).toEqual([["a", "dependency"]])
    expect(s.getSyncStatus()).toMatchObject({ held: 1, dead: 0, failed: 0 })
    arrived = true
    await s.flushSyncQueue()
    expect(byId("a").status).toBe("Synced")
  })

  it("kept for a manager's review (even when the server says rejected): not final here; asked again later; the outcome arrives", async () => {
    localStorage.setItem(QUEUE, JSON.stringify([op("r")]))
    let outcome: Record<string, unknown> = { status: "rejected", kind: "review", error: "APPROVAL_INVALID: the manager approval presented is changed; ..." }
    server(() => outcome)
    const s = await import("../features/pos/services/sync.service")
    await s.flushSyncQueue()
    expect(byId("r")).toMatchObject({ status: "Failed", held: "review", attempts: 0 })
    // not asked again right away (a review takes a person)
    await s.flushSyncQueue()
    expect(pushes).toHaveLength(1)
    // later (or "Check now"): the manager applied it at the server
    outcome = { status: "ok" }
    await s.checkWaitingWorkNow("r")
    expect(pushes).toHaveLength(2)
    expect(byId("r").status).toBe("Synced")
  })

  it("declined by a manager: the server says so (invalid) and it is final", async () => {
    localStorage.setItem(QUEUE, JSON.stringify([op("d", { status: "Failed", held: "review", lastAttemptAt: "2000-01-01T00:00:00.000Z" })]))
    server(() => ({ status: "rejected", kind: "invalid", error: "DISMISSED: declined by a manager" }))
    const s = await import("../features/pos/services/sync.service")
    await s.flushSyncQueue()
    expect(byId("d").status).toBe("Rejected")
  })

  it("a dropped connection is temporary (attempts not used up); a server error counts", async () => {
    localStorage.setItem(QUEUE, JSON.stringify([op("n", { attempts: 4 })]))
    server(() => "drop")
    const s = await import("../features/pos/services/sync.service")
    for (let i = 0; i < 3; i++) { await s.flushSyncQueue(); localStorage.setItem(QUEUE, JSON.stringify(queue().map((o) => ({ ...o, lastAttemptAt: "2000-01-01T00:00:00.000Z" })))) }
    expect(byId("n")).toMatchObject({ status: "Failed", attempts: 4 })
    expect(byId("n").error).toMatch(/^NETWORK: /)
    server(() => 500)
    await s.flushSyncQueue()
    expect(byId("n").attempts).toBe(5)
  })
})

describe("work an earlier version gave up on", () => {
  it("waiting work marked dead or rejected is sent again; anything else stuck is left as it is", async () => {
    localStorage.setItem(QUEUE, JSON.stringify([
      op("dead-recipe", { status: "Failed", attempts: 5, error: 'RECIPE_HELD: "Cappuccino" was made with a recipe revision this server does not have' }),
      op("rejected-review", { status: "Rejected", attempts: 5, error: "APPROVAL_INVALID: the manager approval presented is expired; ..." }),
      op("rejected-rule", { status: "Rejected", attempts: 5, error: "REFUND_EXCEEDS_REFUNDABLE: more than remains" }),
      op("dead-other", { status: "Failed", attempts: 5, error: "Server error" }),
    ]))
    server(() => ({ status: "ok" }))
    const s = await import("../features/pos/services/sync.service")
    await s.flushSyncQueue()
    expect(["dead-recipe", "rejected-review", "rejected-rule", "dead-other"].map((id) => byId(id).status)).toEqual(["Synced", "Synced", "Rejected", "Failed"])
  })
})

describe("whoever signs in meanwhile", () => {
  it("a held operation keeps the staff session and actor it was made under until it is applied", async () => {
    const ev = { v: 1, session: "session-of-rana" }
    localStorage.setItem(QUEUE, JSON.stringify([op("s", { ev, payload: { id: "adj-s", recordedById: "rana", recordedByName: "Rana" } })]))
    let applied = false
    const sent: unknown[] = []
    server(() => (applied ? { status: "ok" } : { status: "error", kind: "dependency", error: 'PRODUCT_PENDING: "Beans" has not reached this server yet' }))
    const fetchMock = globalThis.fetch as unknown as { mock: { calls: Array<[string, RequestInit]> } }
    const s = await import("../features/pos/services/sync.service")
    await s.flushSyncQueue()
    // Maya signs in on this register now; the held operation is still Rana's
    localStorage.setItem("lebanonpos.staff-session.v1", JSON.stringify({ staffId: "maya" }))
    applied = true
    localStorage.setItem(QUEUE, JSON.stringify(queue().map((o) => ({ ...o, lastAttemptAt: "2000-01-01T00:00:00.000Z" }))))
    await s.flushSyncQueue()
    for (const [url, init] of fetchMock.mock.calls) if (String(url).includes("/api/sync/push")) sent.push(...JSON.parse(String(init.body)).operations)
    expect(sent.length).toBe(2)
    for (const o of sent as Array<{ ev: unknown; payload: { recordedById: string } }>) expect([o.ev, o.payload.recordedById]).toEqual([ev, "rana"])
    expect(byId("s").status).toBe("Synced")
  })
})

describe("a send asked for while another is under way", () => {
  it("waits for it and then sends again, so the operation queued just before is included", async () => {
    localStorage.setItem(QUEUE, JSON.stringify([op("first")]))
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    pushes = []
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
      if (!String(url).includes("/api/sync/push")) return new Response("{}", { status: 200 })
      const ids = (JSON.parse(String(init.body)).operations as Array<{ id: string }>).map((o) => o.id)
      pushes.push(ids)
      if (ids.includes("first")) await gate
      return new Response(JSON.stringify({ results: ids.map((id) => ({ id, status: "ok" })) }), { status: 200 })
    }))
    const s = await import("../features/pos/services/sync.service")
    const running = s.flushSyncQueue()
    await vi.waitFor(() => expect(pushes).toHaveLength(1))
    localStorage.setItem(QUEUE, JSON.stringify([...queue(), op("second", { createdAt: "2026-11-02T10:00:01.000Z" })]))
    const mine = s.flushSyncQueue()
    release()
    await Promise.all([running, mine])
    expect(byId("second").status).toBe("Synced")
    expect(pushes).toEqual([["first"], ["second"]])
  })
})
