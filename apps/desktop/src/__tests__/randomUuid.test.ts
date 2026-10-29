// A browser till on a plain-HTTP LAN hub is not a secure context: crypto.randomUUID is missing there
// (measured), crypto.getRandomValues is not. Stock-setting revisions must still get a real v4 UUID.
import { afterEach, describe, expect, it, vi } from "vitest"
import { randomUuid } from "../features/pos/lib/storage"

afterEach(() => vi.unstubAllGlobals())

describe("randomUuid", () => {
  it("without crypto.randomUUID (plain-HTTP origin) builds a valid v4 UUID from getRandomValues", () => {
    const real = globalThis.crypto
    vi.stubGlobal("crypto", { getRandomValues: real.getRandomValues.bind(real) })
    const ids = new Set(Array.from({ length: 200 }, () => randomUuid()))
    expect(ids.size).toBe(200)
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
  it("uses crypto.randomUUID where it exists", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "11111111-1111-4111-8111-111111111111", getRandomValues: () => { throw new Error("unused") } })
    expect(randomUuid()).toBe("11111111-1111-4111-8111-111111111111")
  })
})
