import { useState } from "react"
import { Landmark } from "lucide-react"
import { useI18n } from "@lebanonpos/shared"
import { getSettings, saveSettings } from "../services/settings.service"
import { getShifts, recordAuditEvent } from "../services/security.service"
import { showToast } from "../services/toast.service"

/**
 * Batch 83: the store's drawer scope, chosen by the owner (Settings is a settings.manage page). "One shared
 * drawer" lets every register sell into the one open shift. It changes only while no shift is open (the
 * server refuses it otherwise too, and while work is held for review). Separate drawers are not supported yet.
 */
export default function DrawerScopeCard() {
  const { t } = useI18n()
  const [shared, setShared] = useState(() => getSettings().drawerScope === "shared")
  function change(next: boolean) {
    if (getShifts().some((s) => s.status === "Open")) { showToast(t("settings.drawer.busy"), "error"); return }
    saveSettings({ ...getSettings(), drawerScope: next ? "shared" : null }, { drawerScopeChange: true })
    recordAuditEvent({ action: "settings.drawer_scope", entity: "settings", summary: next ? "Registers set to share one drawer." : "Registers set not to share a drawer.", metadata: { drawerScope: next ? "shared" : null } })
    setShared(next)
    showToast(t(next ? "settings.drawer.saved_shared" : "settings.drawer.saved_off"), "success")
  }
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm" aria-labelledby="drawer-scope-title">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-amber-100 text-amber-700"><Landmark size={21} aria-hidden="true" /></div>
        <div className="min-w-0 flex-1">
          <h2 id="drawer-scope-title" className="text-lg font-bold text-zinc-950">{t("settings.drawer.title")}</h2>
          <label className="mt-2 flex items-start gap-3">
            <input type="checkbox" className="mt-1 h-5 w-5" checked={shared} onChange={(e) => change(e.target.checked)} data-testid="drawer-scope-shared" />
            <span>
              <span className="block font-semibold text-zinc-900">{t("settings.drawer.shared")}</span>
              <span className="block text-sm text-zinc-500">{t("settings.drawer.shared_help")}</span>
            </span>
          </label>
          <p className="mt-2 text-sm text-zinc-500">{t("settings.drawer.separate_note")}</p>
        </div>
      </div>
    </section>
  )
}
