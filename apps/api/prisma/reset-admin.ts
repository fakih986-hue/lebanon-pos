/**
 * Emergency admin reset.
 * Ensures every tenant has an active Admin user with PIN "0000".
 *
 * Run via Railway (injects DATABASE_URL automatically):
 *   railway run npx tsx prisma/reset-admin.ts
 *
 * Or locally with DATABASE_URL set:
 *   DATABASE_URL="postgres://..." npx tsx prisma/reset-admin.ts
 *
 * After logging in, change the PIN from Staff → Change PIN.
 */
import { PrismaClient } from "../src/generated/prisma/index.js"
import bcrypt from "bcryptjs"

const prisma = new PrismaClient()

async function main() {
  const tenants = await prisma.tenant.findMany()
  if (tenants.length === 0) {
    console.log("No tenants found. Nothing to reset.")
    return
  }

  const hashed = await bcrypt.hash("0000", 10)

  for (const tenant of tenants) {
    // Find an existing admin for this tenant
    const existingAdmin = await prisma.staffUser.findFirst({
      where: { tenantId: tenant.id, role: "Admin" },
    })

    if (existingAdmin) {
      await prisma.staffUser.update({
        where: { id: existingAdmin.id },
        data: { pin: hashed, active: true },
      })
      console.log(`✓ Reset Admin "${existingAdmin.name}" PIN to 0000 for store "${tenant.name}" (subdomain: ${tenant.subdomain})`)
    } else {
      const created = await prisma.staffUser.create({
        data: {
          tenantId: tenant.id,
          name: "Recovery Admin",
          mobile: "",
          pin: hashed,
          role: "Admin",
          active: true,
        },
      })
      console.log(`✓ Created new Admin "${created.name}" with PIN 0000 for store "${tenant.name}" (subdomain: ${tenant.subdomain})`)
    }
  }

  console.log("\nDone. Log in with PIN 0000, then change it in Staff → Change PIN.")
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
