import "./setup.js"
import { createServer } from "node:http"
import app from "./app.js"
import { setupWebSocket } from "./ws/index.js"
import prisma from "./lib/prisma.js"

// Must be set before any route handler runs
const JWT_SECRET = process.env.JWT_SECRET
if (!JWT_SECRET || JWT_SECRET === "dev-secret-change-in-production") {
  console.error("FATAL: JWT_SECRET environment variable must be set in production")
  process.exit(1)
}

const PORT = parseInt(process.env.PORT || "3001", 10)

async function main() {
  try {
    await prisma.$connect()
    console.log("Database connected")
  } catch (err) {
    console.error("FATAL: could not connect to database:", err)
    process.exit(1)
  }

  const server = createServer(app)
  setupWebSocket(server)

  server.listen(PORT, () => {
    console.log(`Lebanon POS API running on port ${PORT}`)
    scheduleSyncOperationPrune()
  })

  const shutdown = async () => {
    console.log("\nShutting down gracefully...")
    server.close()
    await prisma.$disconnect()
    process.exit(0)
  }

  process.on("SIGTERM", shutdown)
  process.on("SIGINT", shutdown)
}

main()

// Remove SyncOperations older than 90 days that are already Synced or Failed.
// Runs once at startup then every 24 hours.
function scheduleSyncOperationPrune() {
  pruneSyncOperations().catch((err) => console.error("[prune] sync operations:", err))
  setInterval(() => {
    pruneSyncOperations().catch((err) => console.error("[prune] sync operations:", err))
  }, 24 * 60 * 60 * 1000).unref()
}

async function pruneSyncOperations() {
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
  const { count } = await prisma.syncOperation.deleteMany({
    where: {
      createdAt: { lt: cutoff },
      status: { in: ["Synced", "Failed"] },
    },
  })
  if (count > 0) console.log(`[prune] deleted ${count} old sync operations`)
}
