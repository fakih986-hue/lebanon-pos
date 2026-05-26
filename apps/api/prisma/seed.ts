import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { subdomain: 'default' },
    update: {},
    create: { name: 'Default Tenant', subdomain: 'default' },
  })

  const staff = [
    { name: 'Domain Admin', mobile: '96170123456', pin: '0000', role: 'Admin' as const },
    { name: 'Store Manager', mobile: '96170345678', pin: '0000', role: 'Manager' as const },
    { name: 'Cashier', mobile: '96170567890', pin: '0000', role: 'Cashier' as const },
  ]
  for (const s of staff) {
    const existing = await prisma.staffUser.findFirst({ where: { tenantId: tenant.id, mobile: s.mobile } })
    if (!existing) {
      await prisma.staffUser.create({ data: { tenantId: tenant.id, ...s } })
    }
  }

  const existingSettings = await prisma.appSettings.findUnique({ where: { tenantId: tenant.id } })
  if (!existingSettings) {
    await prisma.appSettings.create({
      data: {
        tenantId: tenant.id,
        storeName: 'Lebanon POS',
        branchName: 'Main Branch',
        phone: '961-1-234567',
        address: 'Beirut, Lebanon',
        vatRate: 0.11,
        usdToLbpRate: 89500,
        receiptFooter: 'Thank you for your visit!',
        lowStockThreshold: 10,
      },
    })
  }

  const productsData = [
    { name: 'Pepsi Can', price: 0.50, cost: 0.35, stock: 100, barcode: '528000000001', category: 'Beverages' },
    { name: 'Coca Cola Can', price: 0.50, cost: 0.35, stock: 100, barcode: '528000000002', category: 'Beverages' },
    { name: 'Fanta Orange', price: 0.50, cost: 0.35, stock: 80, barcode: '528000000003', category: 'Beverages' },
    { name: 'Karak Tea', price: 1.00, cost: 0.50, stock: 60, barcode: '528000000004', category: 'Beverages' },
    { name: 'Water 500ml', price: 0.30, cost: 0.15, stock: 200, barcode: '528000000005', category: 'Beverages' },
    { name: 'Doritos', price: 0.75, cost: 0.45, stock: 90, barcode: '528000000006', category: 'Snacks' },
    { name: "Lay's Chips", price: 0.70, cost: 0.40, stock: 90, barcode: '528000000007', category: 'Snacks' },
    { name: 'Snickers', price: 1.00, cost: 0.65, stock: 70, barcode: '528000000008', category: 'Snacks' },
    { name: 'Kinder Bueno', price: 1.50, cost: 1.00, stock: 50, barcode: '528000000009', category: 'Snacks' },
    { name: 'Laban', price: 1.50, cost: 0.90, stock: 40, barcode: '528000000010', category: 'Dairy' },
    { name: 'Labneh', price: 2.00, cost: 1.20, stock: 35, barcode: '528000000011', category: 'Dairy' },
    { name: 'Halloumi Cheese', price: 3.00, cost: 2.00, stock: 25, barcode: '528000000012', category: 'Dairy' },
    { name: 'Manakeesh', price: 1.50, cost: 0.60, stock: 30, barcode: '528000000013', category: 'Bakery' },
    { name: 'Pita Bread', price: 0.50, cost: 0.20, stock: 120, barcode: '528000000014', category: 'Bakery' },
    { name: 'Kaak', price: 0.75, cost: 0.30, stock: 60, barcode: '528000000015', category: 'Bakery' },
  ]

  const products = []
  for (const p of productsData) {
    const existing = p.barcode ? await prisma.product.findFirst({ where: { tenantId: tenant.id, barcode: p.barcode } }) : null
    if (existing) {
      products.push(existing)
    } else {
      const created = await prisma.product.create({ data: { tenantId: tenant.id, ...p } })
      products.push(created)
    }
  }

  const customersData = [
    { name: 'Ali Hassan', mobile: '96171111111', creditLimit: 100, notes: '' },
    { name: 'Nada Saliba', mobile: '96171222222', creditLimit: 150, notes: '' },
    { name: 'Georges Khoury', mobile: '96171333333', creditLimit: 200, notes: '' },
  ]
  for (const c of customersData) {
    const existing = await prisma.customer.findFirst({ where: { tenantId: tenant.id, mobile: c.mobile } })
    if (!existing) {
      await prisma.customer.create({ data: { tenantId: tenant.id, ...c } })
    }
  }

  const suppliersData = [
    { name: 'Bechara Distribution', mobile: '96171444444', contact: 'Elias Bechara', address: 'Beirut', notes: 'Main beverage supplier' },
    { name: 'Saliba Dairy Farms', mobile: '96171555555', contact: 'Mario Saliba', address: 'Zahle', notes: 'Dairy and bakery products' },
  ]
  const suppliers = []
  for (const s of suppliersData) {
    const existing = await prisma.supplier.findFirst({ where: { tenantId: tenant.id, mobile: s.mobile } })
    if (existing) {
      suppliers.push(existing)
    } else {
      const created = await prisma.supplier.create({ data: { tenantId: tenant.id, ...s } })
      suppliers.push(created)
    }
  }

  if (products.length >= 1 && suppliers.length >= 1) {
    const existing1 = await prisma.inventoryBatch.findFirst({ where: { tenantId: tenant.id, batchNumber: 'BATCH-001' } })
    if (!existing1) {
      await prisma.inventoryBatch.create({
        data: {
          tenantId: tenant.id,
          batchNumber: 'BATCH-001',
          productId: products[0].id,
          productName: products[0].name,
          barcode: products[0].barcode!,
          initialQuantity: 50,
          quantityRemaining: 50,
          unitCost: 0.35,
          unitPrice: 0.50,
          supplierId: suppliers[0].id,
          supplierName: suppliers[0].name,
          status: 'Open',
        },
      })
    }

    const existing2 = await prisma.inventoryBatch.findFirst({ where: { tenantId: tenant.id, batchNumber: 'BATCH-002' } })
    if (!existing2) {
      await prisma.inventoryBatch.create({
        data: {
          tenantId: tenant.id,
          batchNumber: 'BATCH-002',
          productId: products[9].id,
          productName: products[9].name,
          barcode: products[9].barcode!,
          initialQuantity: 30,
          quantityRemaining: 30,
          unitCost: 0.90,
          unitPrice: 1.50,
          supplierId: suppliers[1].id,
          supplierName: suppliers[1].name,
          status: 'Open',
        },
      })
    }
  }
}

main()
  .catch((e) => {
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
