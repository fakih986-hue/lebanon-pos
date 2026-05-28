import "./setup.js"
import { createServer } from "node:http"
import app from "./app.js"
import { setupWebSocket } from "./ws/index.js"

const PORT = parseInt(process.env.PORT || "3001", 10)

const server = createServer(app)
setupWebSocket(server)

server.listen(PORT, () => {
  console.log(`Lebanon POS API running on port ${PORT}`)
})
