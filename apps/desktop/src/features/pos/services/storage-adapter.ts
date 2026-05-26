import { getAll } from "./db"

export async function syncFromDbToLocal(storeName: string, localStorageKey: string): Promise<void> {
  try {
    const data = await getAll<unknown>(storeName)
    if (data.length > 0) {
      localStorage.setItem(localStorageKey, JSON.stringify(data))
      window.dispatchEvent(new Event(`lebanonpos-${localStorageKey}-changed`))
    }
  } catch { /* ignore */ }
}
