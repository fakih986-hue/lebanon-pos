import { getApiUrl, getAuthToken } from "./sync.service"
import { getDeviceId } from "./sync.service"

export type DeviceStatus = "APPROVED" | "REVOKED"

export type PairedDevice = {
  id: string
  tenantId: string
  deviceId: string
  deviceName: string
  registerId: string
  status: DeviceStatus
  firstSeenAt: string
  lastSeenAt: string
  lastIp: string
}

export type PairingCodeResult = {
  ok: true
  code: string
  expiresAt: string
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const apiUrl = getApiUrl()
  const token = getAuthToken()
  const res = await fetch(`${apiUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options?.headers ?? {}),
    },
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? `Request failed (HTTP ${res.status})`)
  return data as T
}

export async function generatePairingCode(): Promise<PairingCodeResult> {
  return apiFetch<PairingCodeResult>("/api/device/generate-code", { method: "POST" })
}

export async function pairDevice(code: string, deviceId: string, deviceName?: string): Promise<{ ok: true; deviceId: string }> {
  const apiUrl = getApiUrl()
  let res: Response
  try {
    res = await fetch(`${apiUrl}/api/device/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, deviceId, deviceName: deviceName ?? "" }),
    })
  } catch {
    throw new Error(`Can't reach ${apiUrl}. Check the hub's LAN URL and that both devices are on the same network.`)
  }
  const raw = await res.text()
  let data: any = null
  try { data = raw ? JSON.parse(raw) : null } catch {
    throw new Error(`Hub returned an unexpected response (HTTP ${res.status}) — check the LAN URL points at the hub's API port, not a different server.`)
  }
  if (!res.ok) throw new Error(data?.error ?? "Pairing failed")
  localStorage.setItem(AUTO_APPROVED_KEY, deviceId)
  return data
}

export async function getDeviceList(): Promise<PairedDevice[]> {
  return apiFetch<PairedDevice[]>("/api/device/list")
}

export async function renameDevice(deviceId: string, deviceName: string): Promise<void> {
  await apiFetch("/api/device/rename", {
    method: "POST",
    body: JSON.stringify({ deviceId, deviceName }),
  })
}

export async function revokeDevice(deviceId: string): Promise<void> {
  await apiFetch("/api/device/revoke", {
    method: "POST",
    body: JSON.stringify({ deviceId }),
  })
}

const AUTO_APPROVED_KEY = "lebanonpos.auto-approved-device.v1"

export async function registerHubDevice(deviceName?: string): Promise<void> {
  try {
    const deviceId = getDeviceId()
    await apiFetch("/api/device/register-hub", {
      method: "POST",
      body: JSON.stringify({ deviceId, deviceName: deviceName ?? "" }),
    })
    localStorage.setItem(AUTO_APPROVED_KEY, deviceId)
  } catch (e) {
    console.warn("[deviceRegistry] registerHubDevice failed, falling back to localStorage:", e)
    autoApproveHubDeviceLocal()
  }
}

function autoApproveHubDeviceLocal(): void {
  try {
    const deviceId = getDeviceId()
    if (!localStorage.getItem(AUTO_APPROVED_KEY)) {
      localStorage.setItem(AUTO_APPROVED_KEY, deviceId)
    }
  } catch { /* storage unavailable */ }
}

export function isHubDeviceAutoApproved(): boolean {
  try {
    return localStorage.getItem(AUTO_APPROVED_KEY) === getDeviceId()
  } catch { return false }
}

// Auto-approve on module load so we have local fallback
autoApproveHubDeviceLocal()
