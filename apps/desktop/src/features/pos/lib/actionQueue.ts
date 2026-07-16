// POS-OWNER-DASHBOARD-POLISH-1: build the owner's action queue from existing
// dashboard signals — action-verb labels, correct destination links, and a
// money/risk priority order. Pure + injectable formatters so it's testable and
// changes no business calculation (it only shapes already-computed numbers).

export type ActionSeverity = "critical" | "warn"

export type ActionItem = {
  key: string
  label: string
  sub: string
  tag: string
  link: string
  /** money-at-risk, used for ordering within a severity tier */
  value: number
  severity: ActionSeverity
}

export type ActionQueueInput = {
  outstanding: number
  debtCustomers: number
  lowStock: Array<{ name: string; stock: number; cost: number }>
  deadStock: Array<{ name: string; stock: number; cost: number }>
  operationalAlerts: Array<{ type: "warning" | "danger" | "info"; message: string; action?: string }>
  fmtMoney: (n: number) => string
  fmtNum: (n: number) => string
}

export function buildActionQueue(input: ActionQueueInput, limit = 8): ActionItem[] {
  const items: ActionItem[] = []

  // Operational alerts (license / sync). Danger = critical → surfaces first.
  for (const a of input.operationalAlerts) {
    const isSync = a.action === "retry-sync"
    items.push({
      key: `op-${a.message}`,
      label: isSync ? "Resolve sync issue" : a.message,
      sub: isSync ? "Open Devices & Sync to retry" : a.message,
      tag: isSync ? "Sync" : "Fix",
      link: "/settings",
      value: 0,
      severity: a.type === "danger" ? "critical" : "warn",
    })
  }

  // Money at risk — collect outstanding debt.
  if (input.outstanding > 0) {
    items.push({
      key: "debt",
      label: "Collect debt",
      sub: `${input.fmtMoney(input.outstanding)} across ${input.fmtNum(input.debtCustomers)} account(s)`,
      tag: "Collect",
      link: "/customers",
      value: input.outstanding,
      severity: "warn",
    })
  }

  // Restock low/out-of-stock items → Receive stock.
  for (const p of input.lowStock) {
    items.push({
      key: `low-${p.name}`,
      label: `Restock ${p.name}`,
      sub: p.stock <= 0 ? "Out of stock" : `${input.fmtNum(p.stock)} left`,
      tag: "Restock",
      link: "/products/new",
      value: p.stock * p.cost,
      severity: "warn",
    })
  }

  // Dead stock — capital tied up, no recent sales.
  for (const d of input.deadStock) {
    items.push({
      key: `dead-${d.name}`,
      label: `Clear ${d.name}`,
      sub: "No sales in 60 days",
      tag: "Dead",
      link: "/products",
      value: d.stock * d.cost,
      severity: "warn",
    })
  }

  // Critical (danger ops) first, then by money-at-risk descending.
  return items
    .sort((a, b) => {
      const ap = a.severity === "critical" ? 0 : 1
      const bp = b.severity === "critical" ? 0 : 1
      if (ap !== bp) return ap - bp
      return b.value - a.value
    })
    .slice(0, limit)
}
