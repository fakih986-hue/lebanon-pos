import express, { type Request, type Response } from "express"
import cors from "cors"
import authRoutes from "./routes/auth.js"
import syncRoutes from "./routes/sync.js"
import dashboardRoutes from "./routes/dashboard.js"
import { errorHandler } from "./middleware/errorHandler.js"
import {
  getCorsOptions,
  rateLimit,
  securityHeaders,
} from "./middleware/security.js"

const app = express()

app.disable("x-powered-by")
app.use(securityHeaders)
app.use(cors(getCorsOptions()))
app.use(express.json({ limit: "10mb" }))

app.use("/api/auth", rateLimit({ windowMs: 60_000, max: 30, bucket: "auth" }))
app.use("/api/sync", rateLimit({ windowMs: 60_000, max: 240, bucket: "sync" }))

app.use("/api/auth", authRoutes)
app.use("/api/sync", syncRoutes)
app.use("/api/dashboard", dashboardRoutes)

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() })
})

app.use(express.static("public", { extensions: ["html"] }))

app.use(errorHandler)

export default app
