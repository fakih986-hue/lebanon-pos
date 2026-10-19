// Fail-closed checks for the local integration-test cloud (scripts/it-cloud.mjs). Pure functions so
// they can be tested; nothing here is used by normal hub or cloud startup.

/** Scratch databases the test cloud may use. Anything else is refused. */
export const SCRATCH_DATABASES = ["lebanonpos_refund_it"]
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1", "[::1]"]
/** Markers of the production cloud or its credentials. */
const PRODUCTION_MARKERS = [/titan-suite\.net/i, /\.railway\.app/i, /\.rlwy\.net/i, /railway\.internal/i]
/** Variables that would connect the process to a cloud, or carry a cloud's credentials. */
const CLOUD_VARS = ["CLOUD_API_URL", "CLOUD_API_KEY", "CLOUD_TENANT_ID", "LBPOS_CLOUD_URL", "RAILWAY_ENVIRONMENT", "RAILWAY_PROJECT_ID", "RAILWAY_SERVICE_ID"]

/**
 * Returns the reasons to refuse starting the test cloud with this environment (empty = allowed).
 * Never includes secret values in a reason.
 */
export function itCloudRefusals(env) {
  const reasons = []
  const raw = env.DATABASE_URL ?? ""
  let db
  try { db = new URL(raw) } catch { reasons.push("DATABASE_URL is missing or not a URL") }
  if (db) {
    const name = decodeURIComponent(db.pathname.replace(/^\//, ""))
    if (!["postgres:", "postgresql:"].includes(db.protocol)) reasons.push("DATABASE_URL is not PostgreSQL")
    if (!LOCAL_HOSTS.includes(db.hostname)) reasons.push(`database host "${db.hostname}" is not local`)
    if (!SCRATCH_DATABASES.includes(name)) reasons.push(`database "${name}" is not an allowlisted scratch database`)
  }
  for (const k of CLOUD_VARS) if ((env[k] ?? "").trim() !== "") reasons.push(`${k} is set (the test cloud must not reach or impersonate a cloud)`)
  if (["true", "1"].includes(String(env.IS_LOCAL_SERVER ?? "").trim())) reasons.push("IS_LOCAL_SERVER is on (that starts the cloud sync bridge)")
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === "string" && PRODUCTION_MARKERS.some((re) => re.test(v))) reasons.push(`${k} names a production host`)
  }
  return [...new Set(reasons)]
}
