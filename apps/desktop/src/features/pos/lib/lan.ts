export function isPrivateIp(ip: string): boolean {
  return /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(ip)
}

export async function discoverLanIps(): Promise<string[]> {
  const results: string[] = []

  const api = (window as { electronAPI?: { getLocalIP?: () => Promise<string> } }).electronAPI
  if (api?.getLocalIP) {
    try {
      const ip = await api.getLocalIP()
      if (ip && ip !== "localhost" && isPrivateIp(ip)) results.push(ip)
    } catch { /* fall through */ }
  }

  return results
}

export function getLanUrl(ip: string, port = 3015): string {
  return `http://${ip}:${port}`
}
