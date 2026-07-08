import { Router } from "express"
import type { IncomingMessage, ServerResponse } from "node:http"
import prisma from "../lib/prisma.js"
import { requireAuth, json, type AuthRequest } from "../middleware/auth.js"

const router = Router()

// ── Low-stock alerts ─────────────────────────────────────────────────
router.get("/low-stock", requireAuth, async (req: AuthRequest, res: ServerResponse) => {
  try {
    const tenantId = (req.query.tenantId as string) || req.auth!.tenantId
    const products = await prisma.product.findMany({
      where: {
        tenantId,
        isParent: false,
        reorderPoint: { not: null },
      },
      select: {
        id: true, name: true, barcode: true, category: true,
        stock: true, cost: true, price: true,
        reorderPoint: true, reorderQuantity: true, supplierName: true,
      },
      orderBy: { stock: "asc" },
    })

    const lowStock = products.filter(p => Number(p.stock) <= (p.reorderPoint ?? 0))
    const result = lowStock.map(p => ({
      ...p,
      stock: Number(p.stock),
      cost: Number(p.cost),
      price: Number(p.price),
      deficit: Math.max(0, (p.reorderPoint ?? 0) - Number(p.stock)),
      suggestedReorder: p.reorderQuantity ?? Math.ceil((p.reorderPoint ?? 0) - Number(p.stock) + 1),
    }))

    json(res, {
      total: result.length,
      items: result,
    })
  } catch (err) {
    console.error("Low stock report error:", err)
    json(res, { error: "Failed to generate low-stock report" }, 500)
  }
})

// ── X Report (mid-shift summary) ─────────────────────────────────────
router.get("/x-report", requireAuth, async (req: AuthRequest, res: ServerResponse) => {
  try {
    const tenantId = (req.query.tenantId as string) || req.auth!.tenantId

    const openShift = await prisma.shift.findFirst({
      where: { tenantId, status: "Open" },
      orderBy: { openedAt: "desc" },
    })
    if (!openShift) {
      json(res, { error: "No open shift found" }, 404)
      return
    }

    const since = openShift.openedAt
    // Shift attribution: match by shiftId first, time fallback for old records
    const shiftFilter: any = { tenantId, OR: [{ shiftId: openShift.id }, { shiftId: null, createdAt: { gte: since } }] }

    const [sales, refunds, expenses, supplierPayments] = await Promise.all([
      prisma.sale.aggregate({
        where: { ...shiftFilter, status: { not: "Voided" } },
        _sum: { total: true, cost: true, profit: true },
        _count: true,
      }),
      prisma.saleRefund.aggregate({
        where: shiftFilter,
        _sum: { total: true },
        _count: true,
      }),
      prisma.expense.aggregate({
        where: shiftFilter,
        _sum: { amount: true },
        _count: true,
      }),
      prisma.supplierPayment.aggregate({
        where: shiftFilter,
        _sum: { amount: true },
      }),
    ])

    const [cashSales, walletSales] = await Promise.all([
      prisma.sale.aggregate({
        where: { ...shiftFilter, status: { not: "Voided" }, paymentMethod: "Cash" },
        _sum: { total: true },
        _count: true,
      }),
      prisma.sale.aggregate({
        where: { ...shiftFilter, status: { not: "Voided" }, paymentMethod: "Wallet" },
        _sum: { total: true },
      }),
    ])

    json(res, {
      type: "X",
      shift: {
        number: openShift.shiftNumber,
        openedAt: openShift.openedAt,
        openedBy: openShift.openedByName,
        openingFloat: Number(openShift.openingFloatUsd ?? 0),
      },
      sales: {
        count: sales._count,
        total: Number(sales._sum.total ?? 0),
        cost: Number(sales._sum.cost ?? 0),
        profit: Number(sales._sum.profit ?? 0),
      },
      refunds: {
        count: refunds._count,
        total: Number(refunds._sum.total ?? 0),
      },
      expenses: {
        count: expenses._count,
        total: Number(expenses._sum.amount ?? 0),
      },
      supplierPayments: {
        total: Number(supplierPayments._sum.amount ?? 0),
      },
      paymentBreakdown: {
      cashSales: { count: cashSales._count, total: Number(cashSales._sum.total ?? 0) },
      wallet: { total: Number(walletSales._sum.total ?? 0) },
      },
      netCash: Number(cashSales._sum.total ?? 0) - Number(refunds._sum.total ?? 0) - Number(expenses._sum.amount ?? 0),
      generatedAt: new Date().toISOString(),
    })
  } catch (err) {
    console.error("X report error:", err)
    json(res, { error: "Failed to generate X report" }, 500)
  }
})

// ── Z Report (end-of-shift summary + close) ──────────────────────────
router.post("/z-report", requireAuth, async (req: AuthRequest, res: ServerResponse) => {
  try {
    const tenantId = (req.query.tenantId as string) || req.auth!.tenantId
    const body = (req as any).body ?? {}
    const shiftId = body.shiftId as string | undefined
    const closingCash = body.closingCash as number | undefined
    const notes = body.notes as string | undefined

    const shift = shiftId
      ? await prisma.shift.findFirst({ where: { id: shiftId, tenantId } })
      : await prisma.shift.findFirst({ where: { tenantId, status: "Open" }, orderBy: { openedAt: "desc" } })

    if (!shift) {
      json(res, { error: "No open shift found" }, 404)
      return
    }

    const since = shift.openedAt
    // Shift attribution: match by shiftId first, time fallback for old records
    const shiftFilter: any = { tenantId, OR: [{ shiftId: shift.id }, { shiftId: null, createdAt: { gte: since } }] }

    const [salesAgg, refundsAgg, expensesAgg, supplierPaymentsAgg, cashSalesAgg] = await Promise.all([
      prisma.sale.aggregate({
        where: { ...shiftFilter, status: { not: "Voided" } },
        _sum: { total: true, cost: true, profit: true },
        _count: true,
      }),
      prisma.saleRefund.aggregate({
        where: shiftFilter,
        _sum: { total: true },
      }),
      prisma.expense.aggregate({
        where: shiftFilter,
        _sum: { amount: true },
      }),
      prisma.supplierPayment.aggregate({
        where: shiftFilter,
        _sum: { amount: true },
      }),
      prisma.sale.aggregate({
        where: { ...shiftFilter, status: { not: "Voided" }, paymentMethod: "Cash" },
        _sum: { total: true },
      }),
    ])

    const cashSales = Number(cashSalesAgg._sum.total ?? 0)
    const cashRefunds = Number(refundsAgg._sum.total ?? 0)
    const cashExpenses = Number(expensesAgg._sum.amount ?? 0)
    const cashSupplierPayments = Number(supplierPaymentsAgg._sum.amount ?? 0)
    const expectedCash = Number(shift.openingFloatUsd ?? 0) + cashSales - cashRefunds - cashExpenses - cashSupplierPayments
    const difference = (closingCash ?? 0) - expectedCash

    const now = new Date()
    const updateResult = await prisma.shift.updateMany({
      where: { id: shift.id, status: "Open" },
      data: {
        status: "Closed",
        closedAt: now,
        closedById: req.auth!.userId,
        closedByName: (body.closedByName as string) ?? req.auth!.userId,
        cashSalesUsd: cashSales,
        cashRefundsUsd: cashRefunds,
        cashExpensesUsd: cashExpenses,
        supplierPaymentsUsd: Number(supplierPaymentsAgg._sum.amount ?? 0),
        expectedCashUsd: expectedCash,
        closingCashUsd: closingCash ?? 0,
        differenceUsd: difference,
        notes: notes ?? undefined,
      },
    })

    if (updateResult.count === 0) {
      json(res, { error: "Shift already closed" }, 409)
      return
    }

    json(res, {
      type: "Z",
      shift: {
        number: shift.shiftNumber,
        openedAt: shift.openedAt,
        closedAt: now.toISOString(),
        openedBy: shift.openedByName,
        closedBy: body.closedByName ?? req.auth!.userId,
        openingFloat: Number(shift.openingFloatUsd ?? 0),
        closingCash: closingCash ?? 0,
      },
      sales: {
        count: salesAgg._count,
        total: Number(salesAgg._sum.total ?? 0),
        cost: Number(salesAgg._sum.cost ?? 0),
        profit: Number(salesAgg._sum.profit ?? 0),
      },
      refunds: { total: cashRefunds },
      expenses: { total: cashExpenses },
      supplierPayments: { total: Number(supplierPaymentsAgg._sum.amount ?? 0) },
      cashReconciliation: {
        openingFloat: Number(shift.openingFloatUsd ?? 0),
        cashSales,
        cashRefunds,
        cashExpenses,
        expectedCash,
        closingCash: closingCash ?? 0,
        difference,
      },
      generatedAt: now.toISOString(),
    })
  } catch (err) {
    console.error("Z report error:", err)
    json(res, { error: "Failed to generate Z report" }, 500)
  }
})

// ── Margin per product/category ──────────────────────────────────────
router.get("/margin", requireAuth, async (req: AuthRequest, res: ServerResponse) => {
  try {
    const tenantId = (req.query.tenantId as string) || req.auth!.tenantId
    const days = Math.min(90, Math.max(1, Number((req as any).query?.days) || 30))
    const since = new Date(Date.now() - days * 86400000)

    const sales = await prisma.sale.findMany({
      where: { tenantId, status: "Completed", createdAt: { gte: since } },
      include: {
        items: {
          select: { productId: true, productName: true, quantity: true, total: true, cost: true },
        },
      },
    })

    const productMap = new Map<number, {
      name: string; category: string; totalRevenue: number; totalCost: number; totalQty: number
    }>()

    const products = await prisma.product.findMany({
      where: { tenantId, isParent: false },
      select: { id: true, name: true, category: true, price: true, cost: true },
    })
    const productInfo = new Map(products.map(p => [p.id, p]))

    for (const sale of sales) {
      for (const item of sale.items) {
        const info = productInfo.get(item.productId)
        const existing = productMap.get(item.productId)
        if (existing) {
          existing.totalRevenue += Number(item.total)
          existing.totalCost += Number(item.cost ?? 0) * item.quantity
          existing.totalQty += item.quantity
        } else {
          productMap.set(item.productId, {
            name: item.productName,
            category: info?.category ?? "Unknown",
            totalRevenue: Number(item.total),
            totalCost: Number(item.cost ?? 0) * item.quantity,
            totalQty: item.quantity,
          })
        }
      }
    }

    const items = Array.from(productMap.entries()).map(([id, v]) => ({
      productId: id,
      name: v.name,
      category: v.category,
      quantity: v.totalQty,
      revenue: Math.round(v.totalRevenue * 100) / 100,
      cost: Math.round(v.totalCost * 100) / 100,
      margin: Math.round((v.totalRevenue - v.totalCost) * 100) / 100,
      marginPct: v.totalRevenue > 0 ? Math.round(((v.totalRevenue - v.totalCost) / v.totalRevenue) * 10000) / 100 : 0,
    })).sort((a, b) => b.margin - a.margin)

    const categories = new Map<string, { revenue: number; cost: number }>()
    for (const item of items) {
      const c = categories.get(item.category) ?? { revenue: 0, cost: 0 }
      c.revenue += item.revenue
      c.cost += item.cost
      categories.set(item.category, c)
    }

    const totalRevenue = items.reduce((s, i) => s + i.revenue, 0)
    const totalCost = items.reduce((s, i) => s + i.cost, 0)

    json(res, {
      period: `${days}d`,
      summary: {
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        totalCost: Math.round(totalCost * 100) / 100,
        totalMargin: Math.round((totalRevenue - totalCost) * 100) / 100,
        marginPct: totalRevenue > 0 ? Math.round(((totalRevenue - totalCost) / totalRevenue) * 10000) / 100 : 0,
      },
      byCategory: Array.from(categories.entries()).map(([name, v]) => ({
        category: name,
        revenue: Math.round(v.revenue * 100) / 100,
        cost: Math.round(v.cost * 100) / 100,
        margin: Math.round((v.revenue - v.cost) * 100) / 100,
        marginPct: v.revenue > 0 ? Math.round(((v.revenue - v.cost) / v.revenue) * 10000) / 100 : 0,
      })).sort((a, b) => b.margin - a.margin),
      byProduct: items,
    })
  } catch (err) {
    console.error("Margin report error:", err)
    json(res, { error: "Failed to generate margin report" }, 500)
  }
})

// ── Customer debt aging ──────────────────────────────────────────────
router.get("/debt-aging", requireAuth, async (req: AuthRequest, res: ServerResponse) => {
  try {
    const tenantId = (req.query.tenantId as string) || req.auth!.tenantId

    const [debtSales, debtPayments, customers] = await Promise.all([
      prisma.debtSale.findMany({
        where: { tenantId },
        select: { id: true, customerId: true, total: true, createdAt: true },
      }),
      prisma.debtPayment.findMany({
        where: { tenantId },
        select: { customerId: true, amount: true },
      }),
      prisma.customer.findMany({
        where: { tenantId },
        select: { id: true, name: true, mobile: true, creditLimit: true },
      }),
    ])

    const now = Date.now()
    const day = 86400000

    const customerDebt = new Map<string, {
      name: string; mobile: string; creditLimit: number;
      totalDebt: number; totalPaid: number; lastSaleDate: string;
      current: number; days30: number; days60: number; days90: number;
    }>()

    for (const c of customers) {
      customerDebt.set(c.id, {
        name: c.name,
        mobile: c.mobile,
        creditLimit: Number(c.creditLimit),
        totalDebt: 0, totalPaid: 0,
        lastSaleDate: "",
        current: 0, days30: 0, days60: 0, days90: 0,
      })
    }

    for (const ds of debtSales) {
      const c = customerDebt.get(ds.customerId)
      if (!c) continue
      c.totalDebt += Number(ds.total)
      if (!c.lastSaleDate || ds.createdAt > new Date(c.lastSaleDate)) {
        c.lastSaleDate = ds.createdAt.toISOString()
      }
      // Aging buckets
      const age = (now - ds.createdAt.getTime()) / day
      const amount = Number(ds.total)
      if (age <= 30) c.current += amount
      else if (age <= 60) c.days30 += amount
      else if (age <= 90) c.days60 += amount
      else c.days90 += amount
    }

    for (const dp of debtPayments) {
      const c = customerDebt.get(dp.customerId)
      if (!c) continue
      c.totalPaid += Number(dp.amount)
    }

    const result = Array.from(customerDebt.entries())
      .map(([id, v]) => ({
        customerId: id,
        ...v,
        totalDebt: Math.round(v.totalDebt * 100) / 100,
        totalPaid: Math.round(v.totalPaid * 100) / 100,
        outstanding: Math.round((v.totalDebt - v.totalPaid) * 100) / 100,
        current: Math.round(v.current * 100) / 100,
        days30: Math.round(v.days30 * 100) / 100,
        days60: Math.round(v.days60 * 100) / 100,
        days90: Math.round(v.days90 * 100) / 100,
      }))
      .filter(c => c.outstanding > 0.005)
      .sort((a, b) => b.outstanding - a.outstanding)

    json(res, {
      totalOutstanding: Math.round(result.reduce((s, c) => s + c.outstanding, 0) * 100) / 100,
      customers: result,
    })
  } catch (err) {
    console.error("Debt aging error:", err)
    json(res, { error: "Failed to generate debt aging report" }, 500)
  }
})

// ── Excel export ─────────────────────────────────────────────────────
router.get("/export/:type", requireAuth, async (req: AuthRequest, res: ServerResponse) => {
  try {
    const tenantId = (req.query.tenantId as string) || req.auth!.tenantId
    const type = (req as any).params?.type as string

    let csv: string
    let filename: string

    switch (type) {
      case "low-stock": {
        const products = await prisma.product.findMany({
          where: { tenantId, isParent: false },
          select: {
            name: true, barcode: true, category: true,
            stock: true, cost: true, price: true,
            reorderPoint: true, reorderQuantity: true, supplierName: true,
          },
          orderBy: { stock: "asc" },
        })
        const lowStock = products.filter(p => Number(p.stock) <= (p.reorderPoint ?? 0))
        csv = "Name,Barcode,Category,Stock,Reorder Point,Suggested Order,Cost,Price,Supplier\n"
        csv += lowStock.map(p =>
          [p.name, p.barcode ?? "", p.category, Number(p.stock), p.reorderPoint ?? 0,
            p.reorderQuantity ?? 0, Number(p.cost), Number(p.price), p.supplierName ?? ""]
            .map(v => typeof v === "string" ? `"${v.replace(/"/g, '""')}"` : v).join(",")
        ).join("\n")
        filename = `low-stock-${new Date().toISOString().slice(0, 10)}.csv`
        break
      }
      case "debt-aging": {
        const [debtSales, debtPayments, customers] = await Promise.all([
          prisma.debtSale.findMany({ where: { tenantId }, select: { customerId: true, total: true, createdAt: true } }),
          prisma.debtPayment.findMany({ where: { tenantId }, select: { customerId: true, amount: true } }),
          prisma.customer.findMany({ where: { tenantId }, select: { id: true, name: true, mobile: true } }),
        ])
        const cmap = new Map<string, { name: string; mobile: string; debt: number; paid: number; last: string }>()
        for (const c of customers) cmap.set(c.id, { name: c.name, mobile: c.mobile, debt: 0, paid: 0, last: "" })
        for (const ds of debtSales) {
          const c = cmap.get(ds.customerId); if (!c) continue
          c.debt += Number(ds.total)
          if (!c.last || ds.createdAt > new Date(c.last)) c.last = ds.createdAt.toISOString()
        }
        for (const dp of debtPayments) {
          const c = cmap.get(dp.customerId); if (!c) continue; c.paid += Number(dp.amount)
        }
        const rows = Array.from(cmap.entries())
          .map(([_, v]) => ({ ...v, outstanding: v.debt - v.paid }))
          .filter(r => r.outstanding > 0.005)
          .sort((a, b) => b.outstanding - a.outstanding)
        csv = "Customer,Mobile,Total Debt,Total Paid,Outstanding,Last Sale\n"
        csv += rows.map(r =>
          [r.name, r.mobile, r.debt.toFixed(2), r.paid.toFixed(2), r.outstanding.toFixed(2),
            r.last ? new Date(r.last).toLocaleDateString() : ""]
            .map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")
        ).join("\n")
        filename = `debt-aging-${new Date().toISOString().slice(0, 10)}.csv`
        break
      }
      case "margin": {
        const days = 30
        const since = new Date(Date.now() - days * 86400000)
        const sales = await prisma.sale.findMany({
          where: { tenantId, status: "Completed", createdAt: { gte: since } },
          include: { items: { select: { productId: true, productName: true, total: true, cost: true, quantity: true } } },
        })
        const products = await prisma.product.findMany({
          where: { tenantId, isParent: false },
          select: { id: true, category: true },
        })
        const catMap = new Map<number, string>(products.map(p => [p.id, p.category]))
        const agg = new Map<string, { cat: string; rev: number; cost: number; qty: number }>()
        for (const s of sales) {
          for (const item of s.items as any[]) {
            const name = item.productName; const cat = catMap.get(item.productId) ?? "Unknown"
            const key = `${cat}|${name}`; const e = agg.get(key) ?? { cat, rev: 0, cost: 0, qty: 0 }
            e.rev += Number(item.total); e.cost += Number(item.cost ?? 0) * (item.quantity ?? 1); e.qty += (item.quantity ?? 1)
            agg.set(key, e)
          }
        }
        csv = "Product,Category,Quantity Sold,Revenue,Cost,Margin,Margin %\n"
        const sorted = Array.from(agg.entries()).sort((a, b) => (b[1].rev - b[1].cost) - (a[1].rev - a[1].cost))
        csv += sorted.map(([name, v]) => {
          const margin = v.rev - v.cost
          return [`"${name.split("|")[1].replace(/"/g, '""')}"`, `"${v.cat}"`, v.qty,
            v.rev.toFixed(2), v.cost.toFixed(2), margin.toFixed(2),
            v.rev > 0 ? ((margin / v.rev) * 100).toFixed(1) + "%" : "0%"].join(",")
        }).join("\n")
        filename = `margin-report-${new Date().toISOString().slice(0, 10)}.csv`
        break
      }
      case "x-report": {
        const shift = await prisma.shift.findFirst({
          where: { tenantId, status: "Open" },
          orderBy: { openedAt: "desc" },
        })
        if (!shift) { json(res, { error: "No open shift" }, 404); return }
        const since = shift.openedAt
        const [sales, refunds, expenses] = await Promise.all([
          prisma.sale.aggregate({
            where: { tenantId, status: "Completed", createdAt: { gte: since } },
            _sum: { total: true, profit: true }, _count: true,
          }),
          prisma.saleRefund.aggregate({
            where: { tenantId, createdAt: { gte: since } },
            _sum: { total: true },
          }),
          prisma.expense.aggregate({
            where: { tenantId, createdAt: { gte: since } },
            _sum: { amount: true },
          }),
        ])
        csv = "Metric,Value\n"
        csv += `Shift Number,"${shift.shiftNumber}"\nOpened At,"${shift.openedAt.toISOString()}"\n`
        csv += `Sales Count,"${sales._count}"\nSales Total,"$${Number(sales._sum.total ?? 0).toFixed(2)}"\n`
        csv += `Refunds,"$${Number(refunds._sum.total ?? 0).toFixed(2)}"\n`
        csv += `Expenses,"$${Number(expenses._sum.amount ?? 0).toFixed(2)}"\n`
        csv += `Net Profit,"$${Number(sales._sum.profit ?? 0).toFixed(2)}"\n`
        filename = `x-report-${shift.shiftNumber}.csv`
        break
      }
      default:
        json(res, { error: `Unknown export type: ${type}. Valid: low-stock, debt-aging, margin, x-report` }, 400)
        return
    }

    res.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    })
    res.end(csv)
  } catch (err) {
    console.error("Export error:", err)
    json(res, { error: "Failed to export report" }, 500)
  }
})

export default router
