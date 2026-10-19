import { describe, it, expect } from "vitest"
// @ts-expect-error plain ESM script without types
import { itCloudRefusals } from "../scripts/it-guard.mjs"

// The integration-test cloud launcher refuses anything that could reach production.
const scratch = "postgresql://u:p@localhost:5432/lebanonpos_refund_it?schema=cloud_it"
const ok = { DATABASE_URL: scratch, JWT_SECRET: "t", IS_LOCAL_SERVER: "false" }
const refused = (env: Record<string, string>) => (itCloudRefusals(env) as string[]).join(" | ")

describe("integration-test cloud guard", () => {
  it("allows a local allowlisted scratch database with no cloud settings", () => {
    expect(itCloudRefusals(ok)).toEqual([])
  })
  it("refuses a database that is not allowlisted, or not local", () => {
    expect(refused({ ...ok, DATABASE_URL: "postgresql://u:p@localhost:5432/lebanonpos" })).toMatch(/not an allowlisted scratch database/)
    expect(refused({ ...ok, DATABASE_URL: "postgresql://u:p@db.example.com:5432/lebanonpos_refund_it" })).toMatch(/not local/)
    expect(refused({ ...ok, DATABASE_URL: "" })).toMatch(/missing/)
  })
  it("refuses production hosts anywhere in the environment", () => {
    expect(refused({ ...ok, DATABASE_URL: "postgresql://u:p@x.proxy.rlwy.net:5432/railway" })).toMatch(/production host/)
    expect(refused({ ...ok, SOME_URL: "https://pos.titan-suite.net" })).toMatch(/production host/)
  })
  it("refuses cloud connection settings and credentials, and the sync bridge", () => {
    for (const k of ["CLOUD_API_URL", "CLOUD_API_KEY", "CLOUD_TENANT_ID", "LBPOS_CLOUD_URL", "RAILWAY_ENVIRONMENT"]) {
      expect(refused({ ...ok, [k]: "x" })).toMatch(new RegExp(k))
    }
    expect(refused({ ...ok, IS_LOCAL_SERVER: "true" })).toMatch(/sync bridge/)
  })
  it("never puts secret values in a refusal", () => {
    const r = refused({ ...ok, CLOUD_API_KEY: "secret-key-123", DATABASE_URL: "postgresql://u:hunter2@prod.rlwy.net/railway" })
    expect(r).not.toMatch(/secret-key-123|hunter2/)
  })
})
