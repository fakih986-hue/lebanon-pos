// Pilot handoff — the remake/waste confirmation never predicts the server's decision. In observe mode the server
// authorizes by the register's connection account, so a cashier on a manager-connected register is applied at once
// and a manager on a cashier-connected one is held; Sync status shows what was actually kept.
import { describe, expect, it } from "vitest"
import { en } from "../../../../packages/shared/src/i18n/en"
import { ar } from "../../../../packages/shared/src/i18n/ar"

describe("remake/waste wording", () => {
  it("states what was recorded and where a hold would show, never that it is held", () => {
    expect(en["waste.recorded_review"]).toMatch(/^Recorded: \{qty\} × \{name\}\. If /)
    expect(en["waste.needs_review"]).toMatch(/may keep this for a manager's review/)
    expect(ar["waste.recorded_review"]).toMatch(/^سُجّل: \{qty\} × \{name\}\. إذا /)
    expect(ar["waste.needs_review"]).toMatch(/قد يحتفظ به الخادم/)
    for (const s of [en["waste.recorded_review"], en["waste.needs_review"]]) expect(s).not.toMatch(/is kept for|for a manager's review:/)
  })
})
