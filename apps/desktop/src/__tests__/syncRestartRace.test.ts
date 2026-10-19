// SYNC-RESTART-RACE: a module instance from before a restart still holds a network response.
// The new instance syncs the operation; then the old response is released. The old instance must
// not overwrite the queue state the new one wrote.
import { beforeEach, describe, expect, it, vi } from "vitest"

const QUEUE = "lebanonpos.sync-queue.v1"
type Held = { resolve: (r: Response) => void; reject: (e: Error) => void }
let held: Held[] = []
let mode: "hold" | "answer" = "hold"
let answer: "ok" | "rejected" = "ok"
const queue = () => JSON.parse(localStorage.getItem(QUEUE) ?? "[]") as Array<{ id: string; status: string; attempts: number; error?: string }>

function reply(body: unknown) { return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }) }

beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
  held = []
  mode = "hold"
  localStorage.setItem("lebanonpos.api-url", "http://hub.test")
  localStorage.setItem("lebanonpos.auth-token", "t")
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
    if (String(url).includes("/api/health")) return Promise.resolve(new Response(null, { status: 200 }))
    if (!String(url).includes("/api/sync/push")) return Promise.reject(new Error("not in this test"))
    const ids = (JSON.parse(String(init?.body)).operations as Array<{ id: string }>).map((o) => o.id)
    const body = () => ({ results: ids.map((id) => ({ id, status: answer, error: answer === "rejected" ? "STALE" : undefined })) })
    if (mode === "answer") return Promise.resolve(reply(body()))
    return new Promise<Response>((resolve, reject) => held.push({ resolve: () => resolve(reply(body())), reject })) // answered as of its release
  }))
})

async function scenario(release: (h: Held) => void) {
  const oldSync = await import("../features/pos/services/sync.service")
  void oldSync.enqueueSyncOperation({ id: "op-race", entity: "supplier", action: "update", summary: "s", payload: { id: "sup" } })
  await vi.waitFor(() => expect(held.length).toBe(1)) // the old instance's write-through is in flight
  vi.resetModules() // restart
  const newSync = await import("../features/pos/services/sync.service")
  mode = "answer"; answer = "ok"
  await newSync.flushSyncQueue()
  expect(queue().find((o) => o.id === "op-race")?.status).toBe("Synced")
  release(held[0]) // the old instance's answer arrives now
  await new Promise((r) => setTimeout(r, 20))
  return queue().find((o) => o.id === "op-race")
}

describe("an old instance's late response after a restart", () => {
  it("released as success: stays Synced", async () => {
    answer = "ok"
    expect((await scenario((h) => h.resolve(undefined as never)))?.status).toBe("Synced")
  })
  it("released as a rejection: does not turn a Synced operation into Rejected", async () => {
    const op = await scenario((h) => { answer = "rejected"; h.resolve(undefined as never) })
    expect(op?.status).toBe("Synced")
  })
  it("released as a lost connection: does not turn a Synced operation into Failed", async () => {
    const op = await scenario((h) => h.reject(new Error("connection reset")))
    expect(op?.status).toBe("Synced")
  })
})
