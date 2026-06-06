import { createHash } from 'node:crypto'
import { PrismaClient } from './src/generated/prisma/index.js'
const prisma = new PrismaClient()
const u = await prisma.staffUser.findFirst({ select: { id: true, name: true, role: true, pin: true, tenantId: true } })
console.log('Admin:', u!.name, u!.role)
console.log('PIN stored:', u!.pin.substring(0, 40))
console.log('PIN is bcrypt:', u!.pin.startsWith('$2'))

// Try to check what PIN 3333 looks like when bcrypt-compared
// And also try to verify plain pins
const bcrypt = await import('bcryptjs')
const check1 = await bcrypt.compare('3333', u!.pin)
console.log('bcrypt.compare(3333):', check1)
const check2 = await bcrypt.compare('2222', u!.pin)
console.log('bcrypt.compare(2222):', check2)

const shaOf3333 = createHash('sha256').update('3333').digest('base64')
console.log('SHA-256(3333):', shaOf3333)
console.log('pin === sha:', u!.pin === shaOf3333)

// Check the .env file
import { readFileSync } from 'node:fs'
try {
  const env = readFileSync('/../electron/.env', 'utf-8')
  console.log('ENV file exists')
} catch { console.log('No env file at electron path') }

await prisma.$disconnect()
