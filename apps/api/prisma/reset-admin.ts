/**
 * Emergency admin reset.
 * Ensures every tenant has an active Admin user with a random recovery PIN.
 *
 * Run via Railway:
 *   railway run npx tsx prisma/reset-admin.ts
 *
 * Or locally:
 *   npx tsx prisma/reset-admin.ts "postgresql://user:pass@host:port/railway"
 *
 * Save the printed recovery PIN immediately; it is not stored in plain text.
 */
import { randomInt } from "node:crypto"
import bcrypt from "bcryptjs"
import { PrismaClient } from "../src/generated/prisma/index.js"

const dbUrl = process.argv[2] || process.env.DATABASE_URL

if (!dbUrl) {
  console.error("No database URL. Pass it as an argument:\n  npx tsx prisma/reset-admin.ts \"postgresql://user:pass@host:port/railway\"")
  process.exit(1)
}

console.log("Connecting to:", dbUrl.replace(/:[^:@]+@/, ":****@"))

const prisma = new PrismaClient({
  datasources: { db: { url: dbUrl } },
})

function generateRecoveryPin() {
  return Array.from({ length: 6 }, () => randomInt(0, 10)).join("")
}

async function main() {
  const tenants = await prisma.tenant.findMany()
  if (tenants.length === 0) {
    console.log("No tenants found. Nothing to reset.")
    return
  }

  for (const tenant of tenants) {
    const recoveryPin = generateRecoveryPin()
    const hashed = await bcrypt.hash(recoveryPin, 12)

    const existingAdmin = await prisma.staffUser.findFirst({
      where: { tenantId: tenant.id, role: "Admin" },
    })

    if (existingAdmin) {
      await prisma.staffUser.update({
        where: { id: existingAdmin.id },
        data: { pin: hashed, active: true },
      })
      console.log(`Reset Admin "${existingAdmin.name}" for store "${tenant.name}" (subdomain: ${tenant.subdomain})`)
      console.log(`  Recovery PIN: ${recoveryPin}`)
    } else {
      const created = await prisma.staffUser.create({
        data: {
          tenantId: tenant.id,
          name: "Recovery Admin",
          mobile: `recovery-${tenant.id}`,
          pin: hashed,
          role: "Admin",
          active: true,
        },
      })
      console.log(`Created new Admin "${created.name}" for store "${tenant.name}" (subdomain: ${tenant.subdomain})`)
      console.log(`  Recovery PIN: ${recoveryPin}`)
    }
  }

  console.log("\nDone. Save the recovery PINs now; they are not stored in plain text.")
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
