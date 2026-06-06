import { PrismaClient } from './src/generated/prisma/index.js'
const prisma = new PrismaClient()

// Get the tenant
const tenant = await prisma.tenant.findFirst()
console.log('Tenant:', tenant?.id, tenant?.subdomain, tenant?.name)

// Create a test staff user with plain text PIN (simulating admin SPA)
const testId = 'test-' + Date.now()
const result = await prisma.staffUser.create({
  data: {
    id: testId,
    tenantId: tenant!.id,
    name: 'Test User',
    mobile: 'mobile-' + Date.now(),
    pin: '1234', // plain text - same as what admin SPA would send
    role: 'Cashier',
    active: true,
  }
})
console.log('Created user:', result.id, 'pin prefix:', result.pin.substring(0, 20))

// Check what was stored
const user = await prisma.staffUser.findUnique({ where: { id: testId } })
console.log('Stored pin is bcrypt:', user!.pin.startsWith('$2'))

await prisma.$disconnect()
