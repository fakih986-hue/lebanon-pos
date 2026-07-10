import { describe, it, expect } from "vitest"
import { compareVersions, getUpdateStatus, formatVersion, type ReleaseManifest } from "../features/pos/lib/version"

const sampleManifest: ReleaseManifest = {
  version: "1.0.8",
  channel: "stable",
  downloadUrl: "https://example.com/setup.exe",
  checksum: { type: "sha256", value: "abc123" },
  releaseNotes: "Test release",
  minimumSupportedVersion: "1.0.5",
  forceUpdate: false,
  publishedAt: "2026-07-10T00:00:00.000Z",
}

describe("compareVersions", () => {
  it("returns 0 for equal versions", () => {
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0)
  })

  it("returns 1 when a > b", () => {
    expect(compareVersions("1.0.1", "1.0.0")).toBe(1)
  })

  it("returns -1 when a < b", () => {
    expect(compareVersions("1.0.0", "1.0.1")).toBe(-1)
  })

  it("handles major version difference", () => {
    expect(compareVersions("2.0.0", "1.9.9")).toBe(1)
    expect(compareVersions("1.9.9", "2.0.0")).toBe(-1)
  })

  it("handles minor version difference", () => {
    expect(compareVersions("1.2.0", "1.1.9")).toBe(1)
  })

  it("strips leading v prefix", () => {
    expect(compareVersions("v1.0.0", "1.0.0")).toBe(0)
    expect(compareVersions("v1.0.1", "1.0.0")).toBe(1)
  })

  it("handles unequal length segments", () => {
    expect(compareVersions("1.0", "1.0.0")).toBe(0)
    expect(compareVersions("1.0.1", "1.0")).toBe(1)
  })
})

describe("getUpdateStatus", () => {
  it("returns unable-to-check when manifest is null", () => {
    const result = getUpdateStatus("1.0.8", null)
    expect(result.status).toBe("unable-to-check")
    expect(result.manifest).toBeNull()
  })

  it("returns up-to-date when installed matches latest", () => {
    const result = getUpdateStatus("1.0.8", sampleManifest)
    expect(result.status).toBe("up-to-date")
  })

  it("returns up-to-date when installed is newer than latest", () => {
    const result = getUpdateStatus("1.0.9", sampleManifest)
    expect(result.status).toBe("up-to-date")
  })

  it("returns update-available when installed is older than latest but above minimum", () => {
    const result = getUpdateStatus("1.0.6", sampleManifest)
    expect(result.status).toBe("update-available")
  })

  it("returns update-required when installed is below minimumSupportedVersion", () => {
    const result = getUpdateStatus("1.0.4", sampleManifest)
    expect(result.status).toBe("update-required")
  })

  it("returns update-available when installed equals minimum and below latest", () => {
    const result = getUpdateStatus("1.0.5", sampleManifest)
    expect(result.status).toBe("update-available")
  })

  it("returns update-required when forceUpdate is true and installed is old", () => {
    const forceManifest: ReleaseManifest = {
      ...sampleManifest,
      forceUpdate: true,
      minimumSupportedVersion: "1.0.7",
    }
    const result = getUpdateStatus("1.0.6", forceManifest)
    expect(result.status).toBe("update-required")
  })

  it("returns attached manifest with result", () => {
    const result = getUpdateStatus("1.0.6", sampleManifest)
    expect(result.manifest).toEqual(sampleManifest)
  })
})

describe("formatVersion", () => {
  it("strips v prefix", () => {
    expect(formatVersion("v1.0.8")).toBe("1.0.8")
  })

  it("passes through without v prefix", () => {
    expect(formatVersion("1.0.8")).toBe("1.0.8")
  })
})
