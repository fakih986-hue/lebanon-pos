import { execSync } from "child_process"

console.log("[setup] started")

try {
  console.log("[setup] Running prisma db push...")
  execSync("npx prisma db push --accept-data-loss", { stdio: "inherit", env: { ...process.env, NO_COLOR: "1" }, timeout: 60_000 })
  console.log("[setup] db push done, running seed...")
  execSync("npx tsx prisma/seed.ts", { stdio: "inherit", env: { ...process.env, NO_COLOR: "1" }, timeout: 60_000 })
  console.log("[setup] Database setup complete.")
} catch (err) {
  console.error("[setup] Database setup failed (continuing anyway):", err)
}

console.log("[setup] complete")
