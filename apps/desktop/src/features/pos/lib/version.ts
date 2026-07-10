export type UpdateStatus = "up-to-date" | "update-available" | "update-required" | "unable-to-check"

export interface ReleaseManifest {
  version: string
  channel: string
  downloadUrl: string
  checksum: { type: string; value: string }
  releaseNotes: string
  minimumSupportedVersion: string
  forceUpdate: boolean
  publishedAt: string
}

function parseSemver(v: string): number[] {
  return v.replace(/^v/, "").split(".").map(Number)
}

export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = parseSemver(a)
  const pb = parseSemver(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0
    const nb = pb[i] ?? 0
    if (na > nb) return 1
    if (na < nb) return -1
  }
  return 0
}

export function getUpdateStatus(
  installedVersion: string,
  manifest: ReleaseManifest | null,
): { status: UpdateStatus; manifest: ReleaseManifest | null } {
  if (!manifest) return { status: "unable-to-check", manifest: null }

  if (manifest.forceUpdate && compareVersions(installedVersion, manifest.minimumSupportedVersion) < 0) {
    return { status: "update-required", manifest }
  }

  if (compareVersions(installedVersion, manifest.minimumSupportedVersion) < 0) {
    return { status: "update-required", manifest }
  }

  if (compareVersions(installedVersion, manifest.version) < 0) {
    return { status: "update-available", manifest }
  }

  return { status: "up-to-date", manifest }
}

export function formatVersion(v: string): string {
  return v.replace(/^v/, "")
}
