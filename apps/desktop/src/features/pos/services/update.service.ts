import { getApiUrl } from "./sync.service"
import { getUpdateStatus, compareVersions, type ReleaseManifest, type UpdateStatus } from "../lib/version"

const MANIFEST_URL_PATH = "/api/releases/manifest"
const CACHE_KEY = "lebanonpos.update-manifest"
const CACHE_TTL_MS = 3_600_000

function getCachedManifest(): { manifest: ReleaseManifest; timestamp: number } | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function setCachedManifest(manifest: ReleaseManifest): void {
  localStorage.setItem(CACHE_KEY, JSON.stringify({ manifest, timestamp: Date.now() }))
}

export async function fetchReleaseManifest(): Promise<ReleaseManifest | null> {
  const cached = getCachedManifest()
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.manifest
  }

  try {
    const apiUrl = getApiUrl()
    if (!apiUrl) return null
    const res = await fetch(`${apiUrl}${MANIFEST_URL_PATH}`, { cache: "no-store" })
    if (!res.ok) return null
    const manifest: ReleaseManifest = await res.json()
    setCachedManifest(manifest)
    return manifest
  } catch {
    const cached = getCachedManifest()
    return cached?.manifest ?? null
  }
}

export async function checkForUpdates(
  installedVersion: string,
): Promise<{ status: UpdateStatus; manifest: ReleaseManifest | null }> {
  const manifest = await fetchReleaseManifest()
  return getUpdateStatus(installedVersion, manifest)
}

export function clearUpdateCache(): void {
  localStorage.removeItem(CACHE_KEY)
}

export function isNewerVersion(installed: string, candidate: string): boolean {
  return compareVersions(candidate, installed) > 0
}
