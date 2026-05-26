import type { IncomingMessage, ServerResponse } from "node:http"

export function errorHandler(
  err: Error,
  _req: IncomingMessage,
  res: ServerResponse,
  _next: (err?: unknown) => void
) {
  console.error("API Error:", err.message, err.stack)
  res.statusCode = 500
  res.setHeader("Content-Type", "application/json")
  res.end(JSON.stringify({ error: err.message || "Internal server error" }))
}
