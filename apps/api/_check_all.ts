import { PrismaClient } from './src/generated/prisma/index.js'
const prisma = new PrismaClient()
const tenants = await prisma.tenant.findMany({ select: { id: true, name: true, subdomain: true } })
console.log('TENANTS:', JSON.stringify(tenants))
const staff = await prisma.staffUser.findMany({ select: { id: true, name: true, role: true, pin: true } })
staff.forEach(u => {
  const isBcrypt = u.pin.startsWith('$2')
  console.log(`STAFF: ${u.name} role=${u.role} pin_prefix=${u.pin.substring(0,25)} isBcrypt=${isBcrypt}`)
})
await prisma.$disconnect()
