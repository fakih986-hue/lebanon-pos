import { formatCurrency, formatLbpCurrency, usdToLbp } from "./currency"
import {
  escapeHtml,
  formatReceiptDate,
  getSaleExchangeRate,
  getSaleGrossSubtotal,
  getSaleRefundTotal,
} from "./salesHelpers"
import type { Sale, SaleRefund } from "../services/sales.service"

export function printSaleReceipt(
  sale: Sale,
  fallbackExchangeRate: number,
  refunds: SaleRefund[]
) {
  const exchangeRate = getSaleExchangeRate(sale, fallbackExchangeRate)
  const totalLbp = usdToLbp(sale.total, exchangeRate)
  const discountTotal = sale.discountTotal ?? 0
  const grossSubtotal = getSaleGrossSubtotal(sale)
  const refundedTotal = getSaleRefundTotal(refunds, sale.id)
  const itemRows = sale.items
    .map(
      (item) => `
        <tr>
          <td>
            <strong>${escapeHtml(item.name)}</strong>
            <span>${escapeHtml(item.barcode)}</span>
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
        <title>${sale.saleNumber}</title>
        <style>
          * { box-sizing: border-box; }
          body { margin: 0; font-family: Arial, sans-serif; color: #111; }
          .receipt { width: 300px; margin: 0 auto; padding: 18px 12px; }
          h1 { margin: 0; text-align: center; font-size: 20px; }
          .muted { color: #666; font-size: 12px; }
          .center { text-align: center; }
          .rule { border-top: 1px dashed #999; margin: 12px 0; }
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
          <h1>Lebanon POS</h1>
          <p class="center muted">${sale.saleNumber}</p>
          <p class="center muted">${formatReceiptDate(sale.createdAt)}</p>
          <div class="rule"></div>
          <div class="row"><span>Cashier</span><strong>${escapeHtml(
            sale.cashier
          )}</strong></div>
          <div class="row"><span>Payment</span><strong>${sale.paymentMethod}</strong></div>
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
            sale.subtotal
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
          <p class="center muted">Thank you</p>
        </div>
      </body>
    </html>
  `)
  receiptWindow.document.close()
  receiptWindow.focus()
  window.setTimeout(() => receiptWindow.print(), 250)
}
