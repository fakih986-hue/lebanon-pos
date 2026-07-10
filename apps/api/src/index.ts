// Load env FIRST — before anything reads process.env.
// dotenv reads DOTENV_CONFIG_PATH if set (the packaged Electron app points this at
// its user-data .env); otherwise it loads ./.env from cwd (dev). On Railway, no
// .env file exists and the real dashboard env vars are used untouched.
import "dotenv/config"
import "./setup.js"
import { createServer } from "node:http"
import app from "./app.js"
import { setupWebSocket } from "./ws/index.js"
import { startCloudSyncBridge } from "./services/cloudSync.js"
import prisma from "./lib/prisma.js"

// Must be set before any route handler runs
const JWT_SECRET = (process.env.JWT_SECRET || "").trim()
if (!JWT_SECRET) {
  console.error("FATAL: JWT_SECRET environment variable must be set")
  process.exit(1)
}

const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || "").trim()
if (!ADMIN_PASSWORD) {
  console.error("FATAL: ADMIN_PASSWORD environment variable must be set")
  process.exit(1)
}

const PORT = parseInt(process.env.PORT || "3015", 10)
const BIND_HOST = process.env.BIND_HOST || "127.0.0.1"

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

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`FATAL: port ${PORT} is already in use`)
    } else {
      console.error("FATAL: server error:", err)
    }
    process.exit(1)
  })

  server.listen(PORT, BIND_HOST, () => {
    console.log(`Titan POS API running on ${BIND_HOST}:${PORT}`)
    scheduleSyncOperationPrune()
    if (["true", "1"].includes(process.env.IS_LOCAL_SERVER || "")) {
      startCloudSyncBridge()
    }
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
