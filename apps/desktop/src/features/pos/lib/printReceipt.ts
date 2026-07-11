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
    .map(
      (item) => `
        <tr>
          <td>
            <strong>${escapeHtml((item as any).name ?? (item as any).productName ?? "Product")}</strong>
            <span>${escapeHtml((item as any).barcode ?? "")}</span>
          </td>
          <td>${item.quantity}</td>
          <td>${formatCurrency(item.unitPrice)}</td>
          <td>${formatCurrency(item.total)}</td>
        </tr>
      `
    )
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
          * { box-sizing: border-box; }
          body { margin: 0; font-family: Arial, sans-serif; color: #111; }
          .receipt { width: 300px; margin: 0 auto; padding: 18px 12px; }
          h1 { margin: 0; text-align: center; font-size: 20px; font-weight: 900; }
          .muted { color: #666; font-size: 11px; }
          .center { text-align: center; }
          .rule { border-top: 1px solid #ddd; margin: 12px 0; }
          .row { display: flex; justify-content: space-between; gap: 12px; margin: 6px 0; }
          table { width: 100%; border-collapse: collapse; font-size: 12px; }
          th, td { padding: 6px 0; text-align: left; vertical-align: top; }
          th:nth-child(n+2), td:nth-child(n+2) { text-align: right; }
          td span { display: block; margin-top: 2px; color: #666; font-size: 10px; }
          .total { font-size: 16px; font-weight: 700; }
          @media print { body { width: 80mm; } .receipt { width: 100%; } }
        </style>
      </head>
      <body>
        <div class="receipt">
          ${settings ? `
            <h1>${escapeHtml(settings.storeName)}</h1>
            <p class="center muted">${escapeHtml(settings.branchName)}</p>
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
          <table>
            <thead>
              <tr><th>Item</th><th>Qty</th><th>Price</th><th>Total</th></tr>
            </thead>
            <tbody>${itemRows}</tbody>
          </table>
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
          ${settings ? `<p class="center muted">${escapeHtml(settings.receiptFooter)}</p>` : ""}
        </div>
      </body>
    </html>
  `)
  receiptWindow.document.close()
  receiptWindow.focus()
  window.setTimeout(() => receiptWindow.print(), 250)
}

export function printLastSaleReceipt(lastSale: LastSaleSummary, settings: AppSettings) {
  const lineItems = (Array.isArray(lastSale.items) ? lastSale.items : [])
    .map(
      (item) => `
        <tr>
          <td>
            <strong>${escapeHtml((item as any).name ?? (item as any).productName ?? "Product")}</strong><br />
            <span>${escapeHtml((item as any).barcode ?? "")}</span>
          </td>
          <td>${item.quantity}</td>
          <td>${formatCurrency(item.price)}</td>
          <td>${formatCurrency(item.price * item.quantity)}</td>
        </tr>
      `
    )
    .join("")
  const tenderRows = lastSale.tender
    ? `
      <tr><td>Paid USD</td><td>${formatUsdCurrency(
        lastSale.tender.paidUsd
      )}</td></tr>
      <tr><td>Paid LBP</td><td>${formatLbpCurrency(
        lastSale.tender.paidLbp
      )}</td></tr>
      <tr><td>Total paid</td><td>${formatUsdCurrency(
        lastSale.tender.paidTotalUsd
      )} / ${formatLbpCurrency(lastSale.tender.paidTotalLbp)}</td></tr>
      <tr><td>Change USD</td><td>${formatUsdCurrency(
        lastSale.tender.changeUsd
      )}</td></tr>
      <tr><td>Change LBP</td><td>${formatLbpCurrency(
        lastSale.tender.changeLbp
      )}</td></tr>
    `
    : ""
  const customerRows =
    lastSale.customerBalanceAfter !== undefined
      ? `
        <tr><td>Customer</td><td>${escapeHtml(
          lastSale.customerName ?? ""
        )}</td></tr>
        <tr><td>Previous balance</td><td>${formatCurrency(
          lastSale.customerBalanceBefore ?? 0
        )}</td></tr>
        <tr><td>New balance</td><td>${formatCurrency(
          lastSale.customerBalanceAfter
        )}</td></tr>
      `
      : ""
  const discountRows =
    lastSale.discountTotal > 0
      ? `
        <tr><td>Items subtotal</td><td>${formatCurrency(
          lastSale.grossSubtotal
        )}</td></tr>
        <tr><td>Discount</td><td>-${formatCurrency(
          lastSale.discountTotal
        )}</td></tr>
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
          @page { size: 80mm auto; margin: 4mm; }
          body { font-family: Arial, sans-serif; color: #000; margin: 0; }
          h1 { font-size: 18px; margin: 0 0 4px; text-align: center; }
          p { margin: 2px 0; font-size: 12px; text-align: center; }
          table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 12px; }
          td, th { border-bottom: 1px solid #ddd; padding: 5px 0; vertical-align: top; }
          th { text-align: left; }
          td:nth-child(2), td:nth-child(3), td:nth-child(4),
          th:nth-child(2), th:nth-child(3), th:nth-child(4) { text-align: right; }
          .summary td:first-child { text-align: left; }
          .summary td:last-child { text-align: right; font-weight: 700; }
          .total { font-size: 16px; font-weight: 700; margin-top: 10px; text-align: right; }
          .muted { color: #444; font-size: 11px; }
        </style>
      </head>
      <body>
        <h1>${escapeHtml(settings.storeName)}</h1>
        <p>${escapeHtml(settings.branchName)}</p>
        <p>${escapeHtml(settings.phone)}</p>
        <p>${escapeHtml(settings.address)}</p>
        <p>Receipt ${lastSale.number}</p>
        <p>${new Date().toLocaleString("en-LB")}</p>
        <table>
          <thead>
            <tr><th>Item</th><th>Qty</th><th>Each</th><th>Total</th></tr>
          </thead>
          <tbody>${lineItems}</tbody>
        </table>
        <table class="summary">
          ${discountRows}
          <tr><td>Subtotal</td><td>${formatCurrency(lastSale.subtotal)}</td></tr>
          <tr><td>VAT ${formatVatRate(settings.vatRate)}</td><td>${formatCurrency(
            lastSale.tax
          )}</td></tr>
          <tr><td>Total USD</td><td>${formatCurrency(lastSale.total)}</td></tr>
          <tr><td>Total LBP</td><td>${formatLbpCurrency(
            lastSale.totalLbp
          )}</td></tr>
          <tr><td>Payment</td><td>${lastSale.paymentMethod}</td></tr>
          <tr><td>Rate</td><td>1 USD = ${formatNumber(
            lastSale.exchangeRate
          )}</td></tr>
          ${tenderRows}
          ${customerRows}
        </table>
        <p class="muted" style="text-align:center;margin-top:10px">Thank you — شكراً</p>
        <p class="muted">${escapeHtml(settings.receiptFooter)}</p>
      </body>
    </html>
  `)
  receiptWindow.document.close()
  receiptWindow.focus()
  window.setTimeout(() => receiptWindow.print(), 250)
}
