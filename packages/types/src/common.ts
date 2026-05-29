export type UserRole = "Admin" | "Manager" | "Cashier" | "Driver"
export type SalePaymentMethod = "Cash" | "Card" | "Wallet" | "Debt"
export type SaleStatus = "Completed" | "Debt" | "Voided"
export type RefundMethod = "Cash" | "Card" | "Wallet" | "Debt Credit"
export type TenderCurrency = "USD" | "LBP" | "Mixed"
export type DeliveryOrderStatus =
  | "Pending" | "Confirmed" | "Preparing"
  | "OutForDelivery" | "Delivered" | "Cancelled"
export type ExpenseCategory =
  | "Supplier" | "Rent" | "Utilities" | "Payroll"
  | "Delivery" | "Maintenance" | "Other"
export type ExpensePaymentMethod =
  | "Cash" | "Card" | "Bank Transfer" | "Wallet" | "On Account"
