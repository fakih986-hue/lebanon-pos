import { useEffect, useMemo, useState } from "react"
import {
  Activity,
  AlertTriangle,
  Banknote,
  Boxes,
  ClipboardList,
  CircleDollarSign,
  HandCoins,
  PackageSearch,
  ReceiptText,
  TrendingUp,
} from "lucide-react"

import { formatCurrency, formatNumber } from "../../features/pos/lib/currency"
import {
  getCustomerLedger,
  getLedgerTotals,
  subscribeLedger,
} from "../../features/pos/services/customer.service"
import {
  getExpenses,
  subscribeExpenses,
  type Expense,
} from "../../features/pos/services/expense.service"
import {
  getProducts,
  subscribeProducts,
} from "../../features/pos/services/product.service"
import {
  getPaymentMix,
  getSales,
  getSalesMetrics,
  getTopProducts,
  subscribeSales,
  type Sale,
} from "../../features/pos/services/sales.service"
import {
  getSettings,
  subscribeSettings,
  type AppSettings,
} from "../../features/pos/services/settings.service"
import {
  getDeadStockItems,
  getExpiryAlerts,
  getPromoSuggestions,
  getReorderSuggestions,
} from "../../features/pos/services/stock.service"
import type { Product } from "../../features/pos/types/product"

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en-LB", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value))
}

export default function DashboardPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [sales, setSales] = useState<Sale[]>(getSales())
  const [expenses, setExpenses] = useState<Expense[]>(getExpenses())
  const [settings, setSettings] = useState<AppSettings>(getSettings())
  const [ledgerVersion, setLedgerVersion] = useState(0)

  useEffect(() => {
    let active = true

    getProducts().then((data) => {
      if (active) {
        setProducts(data)
        setIsLoading(false)
      }
    })

    const unsubscribeProducts = subscribeProducts((data) => setProducts(data))
    const unsubscribeSales = subscribeSales(setSales)
    const unsubscribeExpenses = subscribeExpenses(setExpenses)
    const unsubscribeLedger = subscribeLedger(() =>
      setLedgerVersion((version) => version + 1)
    )
    const unsubscribeSettings = subscribeSettings(setSettings)

    return () => {
      active = false
      unsubscribeProducts()
      unsubscribeSales()
      unsubscribeExpenses()
      unsubscribeLedger()
      unsubscribeSettings()
    }
  }, [])

  const metrics = useMemo(() => getSalesMetrics(), [sales, settings])
  const paymentMix = useMemo(() => getPaymentMix(), [sales])
  const topProducts = useMemo(() => getTopProducts(5), [sales])
  const ledgerTotals = useMemo(() => getLedgerTotals(), [ledgerVersion])
  const customerLedger = useMemo(() => getCustomerLedger(), [ledgerVersion])
  const lowStockProducts = products
    .filter((product) => product.stock <= settings.lowStockThreshold)
    .sort((a, b) => a.stock - b.stock)
    .slice(0, 6)
  const stockValue = products.reduce(
    (sum, product) => sum + product.cost * product.stock,
    0
  )
  const todayExpenseTotal = expenses
    .filter((expense) => new Date(expense.createdAt).toDateString() === new Date().toDateString())
    .reduce((sum, expense) => sum + expense.amount, 0)
  const operatingProfit = metrics.todayProfit - todayExpenseTotal
  const recentSales = sales.slice(0, 6)
  const riskyCustomers = customerLedger
    .filter((customer) => customer.balance > 0)
    .sort((a, b) => b.balance - a.balance)
    .slice(0, 5)
  const reorderSuggestions = useMemo(
    () => getReorderSuggestions(products),
    [products, sales]
  )
  const expiryAlerts = useMemo(() => getExpiryAlerts(products, 30), [products])
  const deadStockItems = useMemo(() => getDeadStockItems(products, 60), [products, sales])
  const promoSuggestions = useMemo(() => getPromoSuggestions(products), [products, sales])
  const ownerDigest = [
    {
      label: "Sales today",
      value: formatCurrency(metrics.todayNetRevenue),
      detail: `${formatNumber(metrics.todayTransactions)} receipts`,
    },
    {
      label: "Cash risk",
      value: formatCurrency(ledgerTotals.outstanding),
      detail: `${formatNumber(riskyCustomers.length)} debt accounts need attention`,
    },
    {
      label: "Inventory work",
      value: formatNumber(reorderSuggestions.filter((item) => item.suggestedQuantity > 0).length),
      detail: `${formatNumber(expiryAlerts.length)} expiry alerts`,
    },
    {
      label: "Promo ideas",
      value: formatNumber(promoSuggestions.length),
      detail: `${formatNumber(deadStockItems.length)} dead-stock items`,
    },
  ]

  if (isLoading) {
    return (
      <main className="flex min-h-0 flex-1 items-center justify-center bg-[#eef3f2] p-6">
        <div className="text-center">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-zinc-200 border-t-zinc-950" />
          <p className="mt-4 text-sm font-medium text-zinc-500">Loading dashboard...</p>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-[#eef3f2] p-6">
      <section className="mb-5 rounded-lg border border-zinc-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-zinc-200 p-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-zinc-950 text-white">
              <ClipboardList size={21} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-zinc-950">
                Daily owner digest
              </h2>
              <p className="text-sm text-zinc-500">
                Sales, cash, stock, and promo pressure for today.
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-3 p-4 md:grid-cols-4">
          {ownerDigest.map((item) => (
            <div
              key={item.label}
              className="rounded-lg border border-zinc-200 bg-zinc-50 p-3"
            >
              <p className="text-sm font-bold text-zinc-500">{item.label}</p>
              <p className="mt-2 text-2xl font-black text-zinc-950">
                {item.value}
              </p>
              <p className="mt-1 text-sm font-medium text-zinc-500">
                {item.detail}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-zinc-500">Net paid</p>
            <CircleDollarSign size={20} className="text-emerald-700" />
          </div>
          <p className="mt-3 text-3xl font-bold text-zinc-950">
            {formatCurrency(metrics.todayNetRevenue)}
          </p>
          <p className="mt-1 text-sm text-zinc-500">
            {formatNumber(metrics.todayTransactions)} transactions
          </p>
        </div>

        <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-zinc-500">Operating profit</p>
            <TrendingUp size={20} className="text-indigo-700" />
          </div>
          <p className="mt-3 text-3xl font-bold text-zinc-950">
            {formatCurrency(operatingProfit)}
          </p>
          <p className="mt-1 text-sm text-zinc-500">
            {formatCurrency(todayExpenseTotal)} expenses today
          </p>
        </div>

        <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-zinc-500">Outstanding</p>
            <HandCoins size={20} className="text-rose-700" />
          </div>
          <p className="mt-3 text-3xl font-bold text-rose-700">
            {formatCurrency(ledgerTotals.outstanding)}
          </p>
          <p className="mt-1 text-sm text-zinc-500">
            {formatNumber(ledgerTotals.customers)} customer accounts
          </p>
        </div>

        <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-zinc-500">Stock value</p>
            <Boxes size={20} className="text-amber-700" />
          </div>
          <p className="mt-3 text-3xl font-bold text-zinc-950">
            {formatCurrency(stockValue)}
          </p>
          <p className="mt-1 text-sm text-zinc-500">
            {formatNumber(lowStockProducts.length)} low stock products
          </p>
        </div>
      </section>

      <section className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(340px,0.7fr)]">
        <div className="rounded-lg border border-zinc-200 bg-white shadow-sm">
          <div className="border-b border-zinc-200 p-4">
            <h2 className="text-xl font-bold text-zinc-950">
              Business command center
            </h2>
            <p className="text-sm text-zinc-500">
              Sales, inventory, debts, and cash signals in one place.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-2">
            <div className="rounded-lg border border-zinc-200 p-4">
              <div className="mb-3 flex items-center gap-2 font-bold text-zinc-950">
                <Banknote size={18} className="text-emerald-700" />
                Payment mix
              </div>
              {Object.entries(paymentMix).map(([method, amount]) => (
                <div
                  key={method}
                  className="flex items-center justify-between border-b border-zinc-100 py-2 last:border-0"
                >
                  <span className="text-sm font-medium text-zinc-600">
                    {method}
                  </span>
                  <span className="font-bold text-zinc-950">
                    {formatCurrency(amount)}
                  </span>
                </div>
              ))}
            </div>

            <div className="rounded-lg border border-zinc-200 p-4">
              <div className="mb-3 flex items-center gap-2 font-bold text-zinc-950">
                <PackageSearch size={18} className="text-indigo-700" />
                Top products
              </div>
              {topProducts.length === 0 ? (
                <p className="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-sm font-medium text-zinc-500">
                  Sales will appear here.
                </p>
              ) : null}
              {topProducts.map((product) => (
                <div
                  key={product.name}
                  className="flex items-center justify-between border-b border-zinc-100 py-2 last:border-0"
                >
                  <div>
                    <p className="font-semibold text-zinc-950">
                      {product.name}
                    </p>
                    <p className="text-sm text-zinc-500">
                      {formatNumber(product.quantity)} sold
                    </p>
                  </div>
                  <span className="font-bold text-zinc-950">
                    {formatCurrency(product.total)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-5">
          <div className="rounded-lg border border-zinc-200 bg-white shadow-sm">
            <div className="border-b border-zinc-200 p-4">
              <div className="flex items-center gap-2">
                <AlertTriangle size={18} className="text-amber-700" />
                <h2 className="text-lg font-bold text-zinc-950">
                  Action queue
                </h2>
              </div>
            </div>
            <div className="space-y-2 p-4">
              {lowStockProducts.length === 0 && riskyCustomers.length === 0 ? (
                <p className="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-sm font-medium text-zinc-500">
                  No urgent work right now.
                </p>
              ) : null}
              {lowStockProducts.map((product) => (
                <div
                  key={product.id}
                  className="rounded-lg border border-amber-200 bg-amber-50 p-3"
                >
                  <p className="font-bold text-amber-900">{product.name}</p>
                  <p className="text-sm text-amber-800">
                    {formatNumber(product.stock)} units left
                  </p>
                </div>
              ))}
              {riskyCustomers.map((customer) => (
                <div
                  key={customer.id}
                  className="rounded-lg border border-rose-200 bg-rose-50 p-3"
                >
                  <p className="font-bold text-rose-900">{customer.name}</p>
                  <p className="text-sm text-rose-800">
                    Owes {formatCurrency(customer.balance)}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-zinc-200 bg-white shadow-sm">
            <div className="border-b border-zinc-200 p-4">
              <div className="flex items-center gap-2">
                <Activity size={18} className="text-zinc-700" />
                <h2 className="text-lg font-bold text-zinc-950">
                  Recent sales
                </h2>
              </div>
            </div>
            <div className="space-y-2 p-4">
              {recentSales.length === 0 ? (
                <p className="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-sm font-medium text-zinc-500">
                  No sales yet.
                </p>
              ) : null}
              {recentSales.map((sale) => (
                <div
                  key={sale.id}
                  className="flex items-center justify-between rounded-lg border border-zinc-200 p-3"
                >
                  <div className="flex items-center gap-2">
                    <ReceiptText size={17} className="text-zinc-500" />
                    <div>
                      <p className="font-bold text-zinc-950">
                        {sale.saleNumber}
                      </p>
                      <p className="text-sm text-zinc-500">
                        {sale.paymentMethod} - {formatTime(sale.createdAt)}
                      </p>
                    </div>
                  </div>
                  <span className="font-bold text-zinc-950">
                    {formatCurrency(sale.total)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
