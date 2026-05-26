import express from "express"
import cors from "cors"
import authRoutes from "./routes/auth.js"
import syncRoutes from "./routes/sync.js"
import { errorHandler } from "./middleware/errorHandler.js"

const app = express()

app.use(cors())
app.use(express.json({ limit: "10mb" }))

app.use("/api/auth", authRoutes)
app.use("/api/sync", syncRoutes)

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() })
})

app.use(errorHandler)

export default app
