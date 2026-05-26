import { execSync } from "child_process"

try {
  console.log("Running database setup...")
  execSync("npx prisma db push --accept-data-loss", { stdio: "inherit", env: { ...process.env, NO_COLOR: "1" } })
  console.log("Running seed...")
  execSync("npx tsx prisma/seed.ts", { stdio: "inherit", env: { ...process.env, NO_COLOR: "1" } })
  console.log("Database setup complete.")
} catch (err) {
  console.error("Database setup failed:", err)
  process.exit(1)
}
