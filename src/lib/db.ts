import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3"
import { PrismaClient } from "@prisma/client"

const adapter = new PrismaBetterSqlite3({
  url: "file:../../../../prisma/dev.db",
})

export const prisma = new PrismaClient({
  adapter,
})