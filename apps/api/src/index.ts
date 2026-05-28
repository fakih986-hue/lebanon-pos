import "./setup.js"
import { createServer } from "node:http"
import app from "./app.js"
import { setupWebSocket } from "./ws/index.js"
import prisma from "./lib/prisma.js"

const PORT = parseInt(process.env.PORT || "3001", 10)

const server = createServer(app)
setupWebSocket(server)

server.listen(PORT, () => {
  console.log(`Lebanon POS API running on port ${PORT}`)
  scheduleSyncOperationPrune()
})

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
