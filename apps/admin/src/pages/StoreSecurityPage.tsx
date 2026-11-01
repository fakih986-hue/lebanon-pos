import { useEffect, useRef, useState } from "react"
import { apiCall } from "../app/api"
import { useI18n } from "@lebanonpos/shared"

type Topology = { mode: "unset" | "direct" | "hub"; hubId: string | null; version: number; changedAt: string | null }
type Hub = { kid: string; hubId: string | null; label: string; status: string; enrolledAt: string; isStoresHub: boolean
  report: { at: string; fresh: boolean; unsent: number; held: number; openShifts: number; policyVersion: number; topologyVersion: number; registers: number } | null }
type Blocker = { code: string; message: string; items?: Array<{ id: string; label: string; detail?: string }> }
type GateBlocker = { id: string; label: string; reason: string; syncSchema: number | null; lastSeenAt: string | null }
type Policy = { mode: "observe" | "enforce-checkout" | "enforce"; version: number; issuedAt: string | null }
type Client = { id: string; label: string; kind: "register" | "hub-link" | "account" | "hub-register"; syncSchema: number; lastSeenAt: string; retiredAt: string | null; retiredNote: string | null
  enrolled: boolean | null; queue: { pending: number; held: number; failed: number; staged: number; journal: number } | null; queueReportedAt: string | null }
type Dialog =
  | { kind: "topology"; to: "direct" | "hub"; hubId: string | null }
  | { kind: "mode"; mode: Policy["mode"] }
  | { kind: "retire" | "readmit"; client: Client }

/**
 * Store security (the owner's control): where the store's stock is decided (its topology), how strictly staff
 * identity is enforced, what still blocks enforcement and which registers and hubs it concerns. Every change is
 * decided and checked by the server (readiness, enrollment, hub key, returning devices); this screen sends the
 * version the owner looked at, so a stale screen or a second owner never silently overwrites a decision.
 */
export function StoreSecurityPage() {
  const { t, locale } = useI18n()
  const [topo, setTopo] = useState<{ topology: Topology; hubs: Hub[] } | null>(null)
  const [gate, setGate] = useState<{ policy: Policy; enforceBlockers: GateBlocker[]; blockers: GateBlocker[] } | null>(null)
  const [clients, setClients] = useState<Client[]>([])
  const [readiness, setReadiness] = useState<{ to: "direct" | "hub"; hubId: string | null; blockers: Blocker[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState("")
  const [notice, setNotice] = useState("")
  const [refused, setRefused] = useState<{ title: string; items: Array<{ label: string; detail: string }> } | null>(null)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [note, setNote] = useState("")
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const openerRef = useRef<HTMLElement | null>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const fmt = (iso: string | null) => (iso ? new Intl.DateTimeFormat(locale === "ar" ? "ar-LB" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)) : "—")
  const tr = (k: string, fallback: string, vars?: Record<string, string | number>) => { const s = t(k, vars); return s === k ? fallback : s }

  async function load() {
    setLoading(true); setErrorMsg("")
    const [a, b, c] = await Promise.all([apiCall<any>("/api/sync/topology"), apiCall<any>("/api/sync/identity-gate"), apiCall<any>("/api/sync/clients")])
    if (a.ok) setTopo({ topology: a.body.topology, hubs: a.body.hubs ?? [] })
    if (b.ok) setGate({ policy: b.body.policy, enforceBlockers: b.body.enforceBlockers ?? [], blockers: b.body.blockers ?? [] })
    if (c.ok) setClients(c.body.clients ?? [])
    const failed = [a, b, c].find((r) => !r.ok)
    if (failed) setErrorMsg(failed.body?.error ?? t("security.load_failed"))
    setLoading(false)
  }
  useEffect(() => { void load() }, [])

  // the dialog keeps focus (Tab and Shift+Tab wrap inside it); Escape closes it; focus returns to its opener
  useEffect(() => {
    if (!dialog) return
    const back = openerRef.current
    const trap = (e: FocusEvent) => { const box = dialogRef.current; if (box && !box.contains(e.target as Node)) box.querySelector<HTMLElement>("textarea")?.focus() }
    document.addEventListener("focusin", trap)
    return () => { document.removeEventListener("focusin", trap); if (back && back.isConnected) back.focus(); else headingRef.current?.focus() }
  }, [dialog])
  const onDialogKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape" && !busy) { setDialog(null); return }
    if (e.key !== "Tab" || !dialogRef.current) return
    const f = [...dialogRef.current.querySelectorAll<HTMLElement>("textarea, input, button:not([disabled])")]
    if (f.length === 0) return
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus() }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus() }
  }
  const open = (e: React.MouseEvent<HTMLElement>, d: Dialog) => { openerRef.current = e.currentTarget; setDialog(d); setNote(""); setConfirmed(false); setRefused(null) }

  async function check(to: "direct" | "hub", hubId: string | null) {
    setBusy(true); setErrorMsg(""); setNotice("")
    const r = await apiCall<any>(`/api/sync/topology?to=${to}${hubId ? `&hubId=${encodeURIComponent(hubId)}` : ""}`)
    if (r.ok) setReadiness(r.body.readiness)
    else setErrorMsg(r.body?.error ?? t("security.load_failed"))
    setBusy(false)
  }

  const needsConfirm = (d: Dialog) => d.kind === "topology" || (d.kind === "mode" && d.mode !== "observe") || (d.kind === "mode" && d.mode === "observe")
  async function submit() {
    if (!dialog || note.trim().length < 3 || (needsConfirm(dialog) && !confirmed)) return
    setBusy(true); setErrorMsg(""); setRefused(null)
    let r: { ok: boolean; status: number; body: any }
    if (dialog.kind === "topology") r = await apiCall("/api/sync/topology", { method: "POST", body: JSON.stringify({ to: dialog.to, ...(dialog.hubId ? { hubId: dialog.hubId } : {}), expectedVersion: topo?.topology.version ?? 0, note: note.trim(), confirm: true }) })
    else if (dialog.kind === "mode") r = await apiCall("/api/sync/identity-mode", { method: "POST", body: JSON.stringify({ mode: dialog.mode, note: note.trim(), expectedVersion: gate?.policy.version ?? 0 }) })
    else r = await apiCall(dialog.client.kind === "hub-register" ? `/api/sync/hub-registers/${encodeURIComponent(dialog.client.id)}/retire` : `/api/sync/clients/${encodeURIComponent(dialog.client.id)}/${dialog.kind}`, { method: "POST", body: JSON.stringify({ note: note.trim() }) })
    setBusy(false)
    if (r.ok) {
      setNotice(dialog.kind === "topology" ? t("security.topology_changed", { version: r.body?.topology?.version ?? "" }) : dialog.kind === "mode" ? t("security.mode_changed", { mode: modeName(r.body?.mode), version: r.body?.version ?? "" }) : t(dialog.kind === "retire" ? "security.retired_ok" : "security.readmitted_ok", { name: dialog.client.label }))
      setDialog(null); setReadiness(null); await load(); return
    }
    const code = r.body?.code
    if (code === "TOPOLOGY_STALE" || code === "POLICY_STALE") { setDialog(null); setNotice(t("security.stale")); await load(); return }
    if (code === "TOPOLOGY_NOT_READY") { setRefused({ title: t("security.not_ready"), items: (r.body.blockers as Blocker[]).map((b) => ({ label: blockerText(b), detail: (b.items ?? []).map((i) => `${i.label}${i.detail ? ` (${i.detail})` : ""}`).join("; ") })) }); return }
    if (code === "IDENTITY_GATE") { setRefused({ title: t("security.gate_refused"), items: (r.body.blockers as GateBlocker[]).map((b) => ({ label: b.label, detail: gateReason(b.reason) })) }); return }
    setRefused({ title: r.body?.error ?? t("security.failed"), items: r.body?.reference ? [{ label: t("security.support_ref"), detail: r.body.reference }] : [] })
  }

  const modeName = (m: string | undefined) => tr(`security.mode.${m}`, m ?? "")
  const gateReason = (r: string) => tr(`security.gate.${r}`, r)
  const blockerText = (b: Blocker) => tr(`security.blk.${b.code}`, b.message)
  const policy = gate?.policy
  const hubs = topo?.hubs ?? []
  const storeHub = hubs.find((h) => h.isStoresHub) ?? null
  const hubPolicy = storeHub?.report?.policyVersion ?? null

  const section = "data-card space-y-3"
  const muted = { color: "var(--text-muted)" }
  const secondary = { color: "var(--text-secondary)" }
  const primary = { color: "var(--text-primary)" }

  return (
    <div className="space-y-6 pb-12">
      <div className="animate-fade-in">
        <h1 ref={headingRef} tabIndex={-1} className="text-3xl font-bold tracking-tight outline-none" style={primary}>{t("security.title")}</h1>
        <p className="text-sm mt-1 max-w-3xl" style={secondary}>{t("security.subtitle")}</p>
      </div>
      {notice && <div role="status" className="data-card text-sm" style={primary}>{notice}</div>}
      {errorMsg && <div role="alert" className="data-card text-sm" style={{ color: "#dc2626" }}>{errorMsg}</div>}
      {loading && !topo ? <p className="text-sm" style={muted}>{t("security.loading")}</p> : (
        <>
          <section className={section} aria-labelledby="sec-topology">
            <h2 id="sec-topology" className="text-xl font-semibold" style={primary}>{t("security.topology_title")}</h2>
            <p className="text-sm" style={secondary}>{t("security.topology_intro")}</p>
            <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]" style={secondary}>
              <dt className="font-medium">{t("security.now")}</dt>
              <dd data-testid="topology-now"><strong style={primary}>{tr(`security.topo.${topo?.topology.mode}`, topo?.topology.mode ?? "—")}</strong>{storeHub ? ` · ${storeHub.label}` : ""}</dd>
              <dt className="font-medium">{t("security.version")}</dt>
              <dd>{t("security.version_of", { version: topo?.topology.version ?? 0, time: fmt(topo?.topology.changedAt ?? null) })}</dd>
            </dl>
            {hubs.length > 0 && (
              <ul className="space-y-2 text-sm" aria-label={t("security.hubs")}>
                {hubs.map((h) => (
                  <li key={h.kid} className="rounded-lg p-3" style={{ border: "1px solid var(--border-color, rgba(0,0,0,.1))" }}>
                    <p className="font-medium" style={primary}><bdi>{h.label}</bdi> · {tr(`security.hubstatus.${h.status}`, h.status)}{h.isStoresHub ? ` · ${t("security.stores_hub")}` : ""}</p>
                    <p style={secondary}>{h.report ? t("security.hub_report", { time: fmt(h.report.at), unsent: h.report.unsent, held: h.report.held, policy: h.report.policyVersion, topology: h.report.topologyVersion }) : t("security.hub_no_report")}{h.report && !h.report.fresh ? ` · ${t("security.hub_stale")}` : ""}</p>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap gap-2">
              <button className="btn-secondary text-sm" disabled={busy} onClick={() => void check("direct", null)}>{t("security.check_direct")}</button>
              {hubs.filter((h) => h.status === "ACTIVE" && h.hubId).map((h) => (
                <button key={h.kid} className="btn-secondary text-sm" disabled={busy} onClick={() => void check("hub", h.hubId)}>{t("security.check_hub", { hub: h.label })}</button>
              ))}
            </div>
            {readiness && (
              <div className="rounded-lg p-3 text-sm" role="region" aria-labelledby="sec-readiness" style={{ background: "var(--bg-secondary, rgba(0,0,0,.04))" }}>
                <h3 id="sec-readiness" className="font-semibold" style={primary}>{t("security.readiness_for", { target: tr(`security.topo.${readiness.to}`, readiness.to) })}</h3>
                {readiness.blockers.length === 0
                  ? <p className="mt-1" style={secondary}>{t("security.ready")}</p>
                  : <ul className="mt-1 list-disc ps-5 space-y-1" style={secondary}>{readiness.blockers.map((b) => (
                      <li key={b.code}><span style={primary}>{blockerText(b)}</span>{b.items?.length ? <ul className="list-[circle] ps-5">{b.items.map((i) => <li key={i.id}><bdi>{i.label}</bdi>{i.detail ? ` — ${i.detail}` : ""}</li>)}</ul> : null}</li>
                    ))}</ul>}
                <button className="btn-primary text-sm mt-2" disabled={busy} onClick={(e) => open(e, { kind: "topology", to: readiness.to, hubId: readiness.hubId })}>{t("security.change_topology")}</button>
              </div>
            )}
          </section>

          <section className={section} aria-labelledby="sec-identity">
            <h2 id="sec-identity" className="text-xl font-semibold" style={primary}>{t("security.identity_title")}</h2>
            <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]" style={secondary}>
              <dt className="font-medium">{t("security.now")}</dt>
              <dd data-testid="mode-now"><strong style={primary}>{modeName(policy?.mode)}</strong></dd>
              <dt className="font-medium">{t("security.cloud_version")}</dt>
              <dd>{t("security.version_of", { version: policy?.version ?? 0, time: fmt(policy?.issuedAt ?? null) })}</dd>
              <dt className="font-medium">{t("security.hub_version")}</dt>
              <dd>{hubPolicy === null ? t("security.no_hub") : hubPolicy === policy?.version ? t("security.hub_same", { version: hubPolicy }) : t("security.hub_behind", { version: hubPolicy })}</dd>
            </dl>
            <ul className="grid gap-2 sm:grid-cols-3 text-sm">
              {(["observe", "enforce-checkout", "enforce"] as const).map((m) => (
                <li key={m} className="rounded-lg p-3" style={{ border: `1px solid ${policy?.mode === m ? "var(--accent, #6366f1)" : "var(--border-color, rgba(0,0,0,.1))"}` }}>
                  <p className="font-semibold" style={primary}>{modeName(m)}{policy?.mode === m ? ` · ${t("security.current")}` : ""}</p>
                  <p className="mt-1" style={secondary}>{t(`security.protects.${m}`)}</p>
                </li>
              ))}
            </ul>
            <p className="text-sm" style={secondary}><strong style={primary}>{t("security.offline_title")}</strong> {t("security.offline_body")}</p>
            <h3 className="text-sm font-semibold" style={primary}>{t("security.blockers_title")}</h3>
            {(gate?.enforceBlockers ?? []).length === 0
              ? <p className="text-sm" style={secondary}>{t("security.no_blockers")}</p>
              : <ul className="list-disc ps-5 text-sm space-y-1" style={secondary}>{gate!.enforceBlockers.map((b) => (
                  <li key={`${b.id}-${b.reason}`}><bdi style={primary}>{b.label}</bdi> — {gateReason(b.reason)}</li>
                ))}</ul>}
            <div className="flex flex-wrap gap-2">
              {policy?.mode !== "enforce" && <button className="btn-primary text-sm" onClick={(e) => open(e, { kind: "mode", mode: "enforce" })}>{t("security.enable_full")}</button>}
              {policy?.mode === "observe" && <button className="btn-secondary text-sm" onClick={(e) => open(e, { kind: "mode", mode: "enforce-checkout" })}>{t("security.enable_partial")}</button>}
              {policy?.mode !== "observe" && <button className="btn-secondary text-sm" onClick={(e) => open(e, { kind: "mode", mode: "observe" })}>{t("security.lower")}</button>}
            </div>
          </section>

          <section className={section} aria-labelledby="sec-devices">
            <h2 id="sec-devices" className="text-xl font-semibold" style={primary}>{t("security.devices_title")}</h2>
            <p className="text-sm" style={secondary}>{t("security.devices_intro")}</p>
            {clients.length === 0 ? <p className="text-sm" style={muted}>{t("security.no_devices")}</p> : (
              <ul className="space-y-2 text-sm">
                {clients.map((c) => (
                  <li key={c.id} className="rounded-lg p-3 flex flex-wrap items-start justify-between gap-2" style={{ border: "1px solid var(--border-color, rgba(0,0,0,.1))" }}>
                    <div className="min-w-0">
                      <p className="font-medium" style={primary}><bdi>{c.label}</bdi> · {t(`security.kind.${c.kind}`)}</p>
                      <p style={secondary}>
                        {t("security.client_line", { schema: c.syncSchema, time: fmt(c.lastSeenAt) })}
                        {c.enrolled === null ? "" : ` · ${c.enrolled ? t("security.enrolled") : t("security.not_enrolled")}`}
                        {c.queue ? ` · ${t("security.queue", { pending: c.queue.pending + c.queue.held + c.queue.failed + c.queue.staged, journal: c.queue.journal })}` : ""}
                      </p>
                      {c.retiredAt && <p style={muted}>{t("security.retired_on", { time: fmt(c.retiredAt), note: c.retiredNote ?? "" })}</p>}
                    </div>
                    {c.retiredAt
                      ? (c.kind !== "hub-register" && <button className="btn-secondary text-sm" onClick={(e) => open(e, { kind: "readmit", client: c })}>{t("security.readmit")}</button>)
                      : <button className="btn-secondary text-sm" onClick={(e) => open(e, { kind: "retire", client: c })}>{t("security.retire")}</button>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {dialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,.6)" }} onClick={() => !busy && setDialog(null)}>
          <div ref={dialogRef} className="data-card w-full max-h-[90dvh] overflow-auto" role="dialog" aria-modal="true" aria-labelledby="sec-dialog" style={{ maxWidth: "560px" }} onClick={(e) => e.stopPropagation()} onKeyDown={onDialogKey}>
            <h2 id="sec-dialog" className="text-lg font-semibold" style={primary}>
              {dialog.kind === "topology" ? t("security.dlg.topology_title", { target: tr(`security.topo.${dialog.to}`, dialog.to) })
                : dialog.kind === "mode" ? t("security.dlg.mode_title", { mode: modeName(dialog.mode) })
                : t(dialog.kind === "retire" ? "security.dlg.retire_title" : "security.dlg.readmit_title", { name: dialog.client.label })}
            </h2>
            <p className="mt-2 text-sm" style={secondary}>
              {dialog.kind === "topology" ? t(`security.dlg.topology_body_${dialog.to}`)
                : dialog.kind === "mode" ? t(`security.dlg.mode_body_${dialog.mode}`)
                : t(`security.dlg.${dialog.kind}_body`)}
            </p>
            {refused && (
              <div role="alert" className="mt-3 rounded-lg p-3 text-sm" style={{ color: "#b91c1c", background: "rgba(220,38,38,.08)" }}>
                <p className="font-semibold">{refused.title}</p>
                {refused.items.length > 0 && <ul className="mt-1 list-disc ps-5">{refused.items.map((i, k) => <li key={k}>{i.label}{i.detail ? <> — <bdi>{i.detail}</bdi></> : null}</li>)}</ul>}
              </div>
            )}
            <label className="mt-4 block text-sm font-medium" style={primary}>
              {t("security.note")}
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={500} autoFocus className="input-field mt-1 w-full" />
            </label>
            {needsConfirm(dialog) && (
              <label className="mt-3 flex items-start gap-2 text-sm" style={primary}>
                <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                <span>{dialog.kind === "topology" ? t("security.dlg.confirm_topology") : dialog.kind === "mode" && dialog.mode === "observe" ? t("security.dlg.confirm_lower") : t("security.dlg.confirm_enforce")}</span>
              </label>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button className="btn-secondary text-sm" disabled={busy} onClick={() => setDialog(null)}>{t("admin.cancel")}</button>
              <button className="btn-primary text-sm" disabled={busy || note.trim().length < 3 || (needsConfirm(dialog) && !confirmed)} style={{ opacity: busy || note.trim().length < 3 || (needsConfirm(dialog) && !confirmed) ? 0.5 : 1 }} onClick={() => void submit()}>{t("security.dlg.confirm")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
