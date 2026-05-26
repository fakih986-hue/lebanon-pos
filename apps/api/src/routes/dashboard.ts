import { Router } from "express"
import type { Response } from "express"
import prisma from "../lib/prisma.js"
import { requireAuth, type AuthRequest } from "../middleware/auth.js"

const router = Router()

router.get("/kpi", requireAuth, async (req: AuthRequest, res: Response) => {
  const tenantId = req.auth!.tenantId

  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const weekStart = new Date(todayStart)
  weekStart.setDate(weekStart.getDate() - weekStart.getDay())
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const thirtyDaysAgo = new Date(todayStart)
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29)

  const completed = { tenantId, status: "Completed" as const }

  const [todaySales, weekSales, monthSales, trendSales, paymentSales, topProductsData, recentSalesData] =
    await Promise.all([
      prisma.sale.findMany({ where: { ...completed, createdAt: { gte: todayStart } } }),
      prisma.sale.findMany({ where: { ...completed, createdAt: { gte: weekStart } } }),
      prisma.sale.findMany({ where: { ...completed, createdAt: { gte: monthStart } } }),
      prisma.sale.findMany({
        where: { ...completed, createdAt: { gte: thirtyDaysAgo } },
        select: { total: true, profit: true, createdAt: true },
      }),
      prisma.sale.groupBy({
        by: ["paymentMethod"],
        where: { ...completed },
        _sum: { total: true },
        _count: { id: true },
      }),
      prisma.saleItem.groupBy({
        by: ["productName", "barcode"],
        where: { sale: { tenantId, status: "Completed" } },
        _sum: { quantity: true, total: true },
        orderBy: { _sum: { total: "desc" } },
        take: 10,
      }),
      prisma.sale.findMany({
        where: { ...completed },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          saleNumber: true,
          total: true,
          paymentMethod: true,
          cashier: true,
          createdAt: true,
          items: { select: { id: true } },
        },
      }),
    ])

  const aggregate = (sales: Array<{ total: number; profit?: number }>) => ({
    count: sales.length,
    revenue: sales.reduce((s, x) => s + x.total, 0),
    profit: sales.reduce((s, x) => s + (x.profit ?? 0), 0),
  })

  const trendMap = new Map<string, { total: number; count: number }>()
  for (let i = 0; i < 30; i++) {
    const d = new Date(thirtyDaysAgo)
    d.setDate(d.getDate() + i)
    trendMap.set(d.toISOString().slice(0, 10), { total: 0, count: 0 })
  }
  for (const s of trendSales) {
    const key = s.createdAt.toISOString().slice(0, 10)
    const entry = trendMap.get(key)
    if (entry) {
      entry.total += s.total
      entry.count++
    }
  }
  const salesTrend = Array.from(trendMap.entries()).map(([date, data]) => ({ date, ...data }))

  ;(res as any).json({
    today: aggregate(todaySales),
    week: aggregate(weekSales),
    month: aggregate(monthSales),
    salesTrend,
    paymentBreakdown: paymentSales.map((p: any) => ({
      method: p.paymentMethod,
      total: p._sum.total ?? 0,
      count: p._count.id,
    })),
    topProducts: topProductsData.map((p: any) => ({
      name: p.productName,
      barcode: p.barcode,
      quantity: p._sum.quantity ?? 0,
      total: p._sum.total ?? 0,
    })),
    recentSales: recentSalesData.map((s: any) => ({
      number: s.saleNumber,
      total: s.total,
      paymentMethod: s.paymentMethod,
      cashier: s.cashier,
      time: s.createdAt.toISOString(),
      items: s.items.length,
    })),
  })
})

export default router
