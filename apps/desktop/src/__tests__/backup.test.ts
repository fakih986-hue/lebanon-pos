import { describe, it, expect } from "vitest"
import {
  buildSafeBackup,
  buildRawBackup,
  redactDeep,
  isValidBackup,
  REDACTED,
} from "../features/pos/lib/backup"

// POS-SETTINGS-DATA-SAFETY-1

const STORE = {
  "lebanonpos.products.v1": JSON.stringify([{ id: 1, name: "Pepsi", price: 0.75, barcode: "A" }]),
  "lebanonpos.sales.v1": JSON.stringify([{ id: "s1", total: 5 }]),
  "lebanonpos.users.v1": JSON.stringify([{ id: 1, name: "Owner", role: "Admin", pin: "HASHABC123", code: "OWN" }]),
  "lebanonpos.settings.v1": JSON.stringify({ storeName: "Test Store", taxRate: 11, cloudKey: "CK-SECRET", tenantKey: "TK-SECRET" }),
  "lebanonpos.session.v1": JSON.stringify({ token: "SECRET-TOKEN", userId: "u1" }),
  "lebanonpos.current-user.v1": JSON.stringify({ id: 1, name: "Owner" }),
}
const getItem = (k: string): string | null => (k in STORE ? (STORE as Record<string, string>)[k] : null)

describe("POS-SETTINGS-DATA-SAFETY-1 — backup redaction", () => {
  describe("redactDeep", () => {
    it("redacts sensitive field names deeply, keeps ordinary fields", () => {
      const out = redactDeep({
        password: "x", token: "y", apiKey: "z", pin: "p", ok: 1, name: "Cola",
        nested: [{ secret: "s", price: 2 }],
      }) as any
      expect(out.password).toBe(REDACTED)
      expect(out.token).toBe(REDACTED)
      expect(out.apiKey).toBe(REDACTED)
      expect(out.pin).toBe(REDACTED)
      expect(out.nested[0].secret).toBe(REDACTED)
      // business fields untouched
      expect(out.ok).toBe(1)
      expect(out.name).toBe("Cola")
      expect(out.nested[0].price).toBe(2)
    })

    it("does not over-redact lookalike field names", () => {
      const out = redactDeep({ spin: 1, keychain: 2, barcode: "5", description: "d" }) as any
      expect(out).toEqual({ spin: 1, keychain: 2, barcode: "5", description: "d" })
    })
  })

  describe("buildSafeBackup", () => {
    const safe = buildSafeBackup(getItem)
    const str = JSON.stringify(safe)

    it("redacts staff PINs and cloud/tenant keys", () => {
      expect((safe["lebanonpos.users.v1"] as any)[0].pin).toBe(REDACTED)
      expect((safe["lebanonpos.settings.v1"] as any).cloudKey).toBe(REDACTED)
      expect((safe["lebanonpos.settings.v1"] as any).tenantKey).toBe(REDACTED)
    })

    it("omits the live session and current-user stores entirely", () => {
      expect(safe).not.toHaveProperty("lebanonpos.session.v1")
      expect(safe).not.toHaveProperty("lebanonpos.current-user.v1")
    })

    it("still includes useful business data", () => {
      expect((safe["lebanonpos.products.v1"] as any)[0].name).toBe("Pepsi")
      expect((safe["lebanonpos.sales.v1"] as any)[0].total).toBe(5)
      expect((safe["lebanonpos.settings.v1"] as any).storeName).toBe("Test Store")
      expect((safe["lebanonpos.settings.v1"] as any).taxRate).toBe(11)
      // staff name/role kept (only the PIN is stripped)
      expect((safe["lebanonpos.users.v1"] as any)[0]).toMatchObject({ name: "Owner", role: "Admin" })
    })

    it("leaks NO secret values in the serialized backup", () => {
      expect(str).not.toContain("HASHABC123")
      expect(str).not.toContain("SECRET-TOKEN")
      expect(str).not.toContain("CK-SECRET")
      expect(str).not.toContain("TK-SECRET")
      expect(str).toContain("Pepsi") // but keeps business data
    })
  })

  describe("buildRawBackup", () => {
    it("keeps everything verbatim (the admin-gated escape hatch)", () => {
      const raw = buildRawBackup(getItem)
      expect(raw["lebanonpos.session.v1"]).toContain("SECRET-TOKEN")
      expect(raw["lebanonpos.users.v1"]).toContain("HASHABC123")
      expect(raw["lebanonpos.products.v1"]).toContain("Pepsi")
    })
  })

  describe("isValidBackup", () => {
    it("accepts an object containing at least one known store", () => {
      expect(isValidBackup({ "lebanonpos.products.v1": "[]" })).toBe(true)
    })
    it("rejects invalid shapes", () => {
      expect(isValidBackup(null)).toBe(false)
      expect(isValidBackup([])).toBe(false)
      expect(isValidBackup({})).toBe(false)
      expect(isValidBackup({ foo: 1 })).toBe(false)
      expect(isValidBackup("not-json")).toBe(false)
    })
  })
})
