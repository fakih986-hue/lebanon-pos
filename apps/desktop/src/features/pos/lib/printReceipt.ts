import { formatCurrency, formatLbpCurrency, formatNumber, formatUsdCurrency, usdToLbp } from "./currency"
import {
  escapeHtml,
  formatReceiptDate,
  getSaleExchangeRate,
  getSaleGrossSubtotal,
  getSaleRefundTotal,
} from "./salesHelpers"
import { formatVatRate } from "./helpers"
import type { Sale, SaleRefund } from "../services/sales.service"
import type { AppSettings } from "../services/settings.service"
import { getReceiptPrinter, receiptPageCss } from "./receiptPrinter"

/** One item: the full name on its own line (wraps, Arabic-aware), then quantity × price and the line total. */
function itemBlock(name: string, barcode: string, quantity: number, unit: number, total: number) {
  return `
    <div class="item">
      <div class="item-name" dir="auto">${escapeHtml(name)}</div>
      <div class="item-meta"><span>${formatNumber(quantity)} × ${formatCurrency(unit)}</span><strong>${formatCurrency(total)}</strong></div>
      ${barcode ? `<div class="item-code">${escapeHtml(barcode)}</div>` : ""}
    </div>`
}

type CartItem = {
  id: number
  name: string
  barcode: string
  quantity: number
  price: number
}

type SaleTender = {
  paidUsd: number
  paidLbp: number
  paidTotalUsd: number
  paidTotalLbp: number
  changeUsd: number
  changeLbp: number
}

export type LastSaleSummary = {
  number: string
  paymentMethod: string
  customerName?: string
  grossSubtotal: number
  subtotal: number
  discountTotal: number
  tax: number
  total: number
  totalLbp: number
  /** Cash payable after LBP rounding, when the sale was cash. */
  payableLbp?: number
  payableUsd?: number
  exchangeRate: number
  tender?: SaleTender
  profit?: number
  customerBalanceBefore?: number
  customerBalanceAfter?: number
  items: CartItem[]
}

export function printSaleReceipt(
  sale: Sale,
  fallbackExchangeRate: number,
  refunds: SaleRefund[],
  settings?: AppSettings
) {
  const exchangeRate = getSaleExchangeRate(sale, fallbackExchangeRate)
  const totalLbp = usdToLbp(sale.total, exchangeRate)
  const discountTotal = sale.discountTotal ?? 0
  const grossSubtotal = getSaleGrossSubtotal(sale)
  const refundedTotal = getSaleRefundTotal(refunds, sale.id)
  const itemRows = (Array.isArray(sale.items) ? sale.items : [])
    .map((item) => itemBlock((item as any).name ?? (item as any).productName ?? "Product", (item as any).barcode ?? "", item.quantity, item.unitPrice, item.total))
    .join("")

  const receiptWindow = window.open("", "_blank", "width=420,height=720")

  if (!receiptWindow) {
    return
  }

  receiptWindow.document.write(`
    <html>
      <head>
        <title>${escapeHtml(sale.saleNumber ?? "Sale")}</title>
        <style>
          ${receiptPageCss(getReceiptPrinter())}
          .center { text-align: center; }
          .row { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: 0 8px; padding: 3px 0; }
          .row > :last-child { margin-inline-start: auto; text-align: end; }
          .row.total { font-size: 15px; font-weight: 700; }
        </style>
      </head>
      <body>
        <div class="receipt">
          ${settings ? `
            <h1 dir="auto">${escapeHtml(settings.storeName)}</h1>
            <p class="center muted" dir="auto">${escapeHtml(settings.branchName)}</p>
            <p class="center muted">${escapeHtml(settings.phone)}</p>
            <div class="rule"></div>
          ` : `<h1>Titan POS</h1><div class="rule"></div>`}
          <p class="center muted">${escapeHtml(sale.saleNumber ?? "")}</p>
          <p class="center muted">${sale.createdAt ? formatReceiptDate(sale.createdAt) : ""}</p>
          <div class="row"><span>Cashier</span><strong>${escapeHtml(
            sale.cashier ?? ""
          )}</strong></div>
          <div class="row"><span>Payment</span><strong>${sale.paymentMethod ?? ""}</strong></div>
          ${
            sale.customerName
              ? `<div class="row"><span>Customer</span><strong>${escapeHtml(
                  sale.customerName
                )}</strong></div>`
              : ""
          }
          <div class="rule"></div>
          ${itemRows}
          <div class="rule"></div>
          ${
            discountTotal > 0
              ? `
                <div class="row"><span>Items subtotal</span><strong>${formatCurrency(
                  grossSubtotal
                )}</strong></div>
                <div class="row"><span>Discount</span><strong>-${formatCurrency(
                  discountTotal
                )}</strong></div>
              `
              : ""
          }
          <div class="row"><span>Subtotal</span><strong>${formatCurrency(
            sale.subtotal ?? 0
          )}</strong></div>
          <div class="row"><span>VAT</span><strong>${formatCurrency(
            sale.tax
          )}</strong></div>
          <div class="row total"><span>Total</span><span>${formatCurrency(
            sale.total
          )}</span></div>
          <div class="row"><span>Total LBP</span><strong>${formatLbpCurrency(
            totalLbp
          )}</strong></div>
          ${
            sale.payableLbp && sale.payableLbp !== totalLbp
              ? `
                <div class="row" style="font-size: 11px; color: #856404;"><span>Cash rounding</span><strong>+${formatLbpCurrency(sale.payableLbp - totalLbp)}</strong></div>
                <div class="row total"><span>Cash payable</span><span>${formatLbpCurrency(sale.payableLbp)}</span></div>
              `
              : ""
          }
          ${
            refundedTotal > 0
              ? `
                <div class="row"><span>Refunded</span><strong>-${formatCurrency(
                  refundedTotal
                )}</strong></div>
                <div class="row"><span>Net receipt</span><strong>${formatCurrency(
                  Math.max(0, sale.total - refundedTotal)
                )}</strong></div>
              `
              : ""
          }
          ${
            sale.tender
              ? `
                <div class="rule"></div>
                <div class="row"><span>Paid</span><strong>${formatCurrency(
                  sale.tender.paidTotalUsd
                )}</strong></div>
                <div class="row"><span>Change USD</span><strong>${formatCurrency(
                  sale.tender.changeUsd
                )}</strong></div>
                <div class="row"><span>Change LBP</span><strong>${formatLbpCurrency(
                  sale.tender.changeLbp
                )}</strong></div>
              `
              : ""
          }
          <div class="rule"></div>
          <p class="center muted">Thank you — شكراً</p>
          ${settings ? `<p class="center muted" dir="auto">${escapeHtml(settings.receiptFooter)}</p>` : ""}
        </div>
      </body>
    </html>
  `)
  receiptWindow.document.close()
  receiptWindow.focus()
  window.setTimeout(() => receiptWindow.print(), 250)
}

/** A receipt with long English and Arabic names, large totals and the rounding lines, for checking a real printer. */
export function printTestReceipt(settings: AppSettings) {
  const rate = 89_500
  const items: CartItem[] = [
    { id: 1, name: "Water Bottle 500ml Natural Mineral Spring, Family Pack of 6 Bottles", barcode: "5281001000031234", quantity: 12, price: 1234.5 },
    { id: 2, name: "مياه معدنية طبيعية من الينابيع، عبوة عائلية من ست زجاجات سعة ٥٠٠ مل", barcode: "5281001000032", quantity: 1, price: 0.45 },
  ]
  const total = 14814.45
  const totalLbp = Math.round(total * rate)
  printLastSaleReceipt({
    number: "TEST-PRINT", paymentMethod: "Cash", grossSubtotal: total, subtotal: total, discountTotal: 0, tax: 0, total, totalLbp,
    payableLbp: Math.ceil(totalLbp / 5000) * 5000, payableUsd: total, exchangeRate: rate, items,
    tender: { paidUsd: 15000, paidLbp: 250000, paidTotalUsd: 15002.79, paidTotalLbp: 1342750000, changeUsd: 188.34, changeLbp: 16856430 },
  }, settings)
}

export function printLastSaleReceipt(lastSale: LastSaleSummary, settings: AppSettings) {
  const lineItems = (Array.isArray(lastSale.items) ? lastSale.items : [])
    .map((item) => itemBlock((item as any).name ?? (item as any).productName ?? "Product", (item as any).barcode ?? "", item.quantity, item.price, item.price * item.quantity))
    .join("")
  const tenderRows = lastSale.tender
    ? `
      <div class="line"><span>Paid USD</span><span>${formatUsdCurrency(
        lastSale.tender.paidUsd
      )}</span></div>
      <div class="line"><span>Paid LBP</span><span>${formatLbpCurrency(
        lastSale.tender.paidLbp
      )}</span></div>
      <div class="line"><span>Total paid</span><span>${formatUsdCurrency(
        lastSale.tender.paidTotalUsd
      )} / ${formatLbpCurrency(lastSale.tender.paidTotalLbp)}</span></div>
      <div class="line"><span>Change USD</span><span>${formatUsdCurrency(
        lastSale.tender.changeUsd
      )}</span></div>
      <div class="line"><span>Change LBP</span><span>${formatLbpCurrency(
        lastSale.tender.changeLbp
      )}</span></div>
    `
    : ""
  const customerRows =
    lastSale.customerBalanceAfter !== undefined
      ? `
        <div class="line"><span>Customer</span><span>${escapeHtml(
          lastSale.customerName ?? ""
        )}</span></div>
        <div class="line"><span>Previous balance</span><span>${formatCurrency(
          lastSale.customerBalanceBefore ?? 0
        )}</span></div>
        <div class="line"><span>New balance</span><span>${formatCurrency(
          lastSale.customerBalanceAfter
        )}</span></div>
      `
      : ""
  const discountRows =
    lastSale.discountTotal > 0
      ? `
        <div class="line"><span>Items subtotal</span><span>${formatCurrency(
          lastSale.grossSubtotal
        )}</span></div>
        <div class="line"><span>Discount</span><span>-${formatCurrency(
          lastSale.discountTotal
        )}</span></div>
      `
      : ""

  const receiptWindow = window.open("", "lebanonpos-receipt")
  if (!receiptWindow) return

  receiptWindow.document.write(`
    <!doctype html>
    <html>
      <head>
        <title>${lastSale.number}</title>
        <style>
          ${receiptPageCss(getReceiptPrinter())}
        </style>
      </head>
      <body>
        <h1 dir="auto">${escapeHtml(settings.storeName)}</h1>
        <p dir="auto">${escapeHtml(settings.branchName)}</p>
        <p>${escapeHtml(settings.phone)}</p>
        <p dir="auto">${escapeHtml(settings.address)}</p>
        <p>Receipt ${lastSale.number}</p>
        <p>${new Date().toLocaleString("en-LB")}</p>
        <div class="rule"></div>
        ${lineItems}
        <div class="rule"></div>
        <div class="summary">
          ${discountRows}
          <div class="line"><span>Subtotal</span><span>${formatCurrency(lastSale.subtotal)}</span></div>
          <div class="line"><span>VAT ${formatVatRate(settings.vatRate)}</span><span>${formatCurrency(
            lastSale.tax
          )}</span></div>
          <div class="line total"><span>Total USD</span><span>${formatCurrency(lastSale.total)}</span></div>
          <div class="line"><span>Total LBP</span><span>${formatLbpCurrency(
            lastSale.totalLbp
          )}</span></div>
          ${
            // Same lines as the reprint (printSaleReceipt): what the cash customer actually paid,
            // so total, paid and change reconcile on paper. Display only; the calculation is unchanged.
            lastSale.payableLbp && lastSale.payableLbp !== lastSale.totalLbp
              ? `<div class="line warn"><span>Cash rounding</span><span>+${formatLbpCurrency(lastSale.payableLbp - lastSale.totalLbp)}</span></div>
          <div class="line total"><span>Cash payable</span><span>${formatLbpCurrency(lastSale.payableLbp)}${lastSale.payableUsd ? ` · ${formatUsdCurrency(lastSale.payableUsd)}` : ""}</span></div>`
              : ""
          }
          <div class="line"><span>Payment</span><span>${lastSale.paymentMethod}</span></div>
          <div class="line"><span>Rate</span><span>1 USD = ${formatNumber(
            lastSale.exchangeRate
          )}</span></div>
          ${tenderRows}
          ${customerRows}
        </div>
        <div class="rule"></div>
        <p class="muted">Thank you — شكراً</p>
        <p class="muted" dir="auto">${escapeHtml(settings.receiptFooter)}</p>
      </body>
    </html>
  `)
  receiptWindow.document.close()
  receiptWindow.focus()
  window.setTimeout(() => receiptWindow.print(), 250)
}
