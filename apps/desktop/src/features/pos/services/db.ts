import { openDB, type IDBPDatabase } from "idb"

const DB_NAME = "lebanonpos"
const DB_VERSION = 2

let dbPromise: Promise<IDBPDatabase> | null = null

function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("products")) {
          db.createObjectStore("products", { keyPath: "id" })
        }
        if (!db.objectStoreNames.contains("sales")) {
          db.createObjectStore("sales", { keyPath: "id" })
        }
        if (!db.objectStoreNames.contains("refunds")) {
          db.createObjectStore("refunds", { keyPath: "id" })
        }
        if (!db.objectStoreNames.contains("customers")) {
          db.createObjectStore("customers", { keyPath: "id" })
        }
        if (!db.objectStoreNames.contains("debt-sales")) {
          db.createObjectStore("debt-sales", { keyPath: "id" })
        }
        if (!db.objectStoreNames.contains("debt-payments")) {
          db.createObjectStore("debt-payments", { keyPath: "id" })
        }
        if (!db.objectStoreNames.contains("suppliers")) {
          db.createObjectStore("suppliers", { keyPath: "id" })
        }
        if (!db.objectStoreNames.contains("purchase-orders")) {
          db.createObjectStore("purchase-orders", { keyPath: "id" })
        }
        if (!db.objectStoreNames.contains("supplier-payments")) {
          db.createObjectStore("supplier-payments", { keyPath: "id" })
        }
        if (!db.objectStoreNames.contains("users")) {
          db.createObjectStore("users", { keyPath: "id" })
        }
        if (!db.objectStoreNames.contains("shifts")) {
          db.createObjectStore("shifts", { keyPath: "id" })
        }
        if (!db.objectStoreNames.contains("audit")) {
          db.createObjectStore("audit", { keyPath: "id" })
        }
        if (!db.objectStoreNames.contains("settings")) {
          db.createObjectStore("settings", { keyPath: "id" })
        }
        if (!db.objectStoreNames.contains("expenses")) {
          db.createObjectStore("expenses", { keyPath: "id" })
        }
        if (!db.objectStoreNames.contains("stock-counts")) {
          db.createObjectStore("stock-counts", { keyPath: "id" })
        }
        if (!db.objectStoreNames.contains("inventory-batches")) {
          db.createObjectStore("inventory-batches", { keyPath: "id" })
        }
        if (!db.objectStoreNames.contains("inventory-adjustments")) {
          db.createObjectStore("inventory-adjustments", { keyPath: "id" })
        }
        if (!db.objectStoreNames.contains("held-sales")) {
          db.createObjectStore("held-sales", { keyPath: "id" })
        }
        if (!db.objectStoreNames.contains("daily-closes")) {
          db.createObjectStore("daily-closes", { keyPath: "id" })
        }
        if (!db.objectStoreNames.contains("sync-queue")) {
          db.createObjectStore("sync-queue", { keyPath: "id" })
        }
        if (!db.objectStoreNames.contains("session")) {
          db.createObjectStore("session")
        }
        if (!db.objectStoreNames.contains("current-user")) {
          db.createObjectStore("current-user")
        }
        if (!db.objectStoreNames.contains("lebanonpos-migration")) {
          db.createObjectStore("lebanonpos-migration", { keyPath: "key" })
        }
        if (!db.objectStoreNames.contains("delivery-orders")) {
          db.createObjectStore("delivery-orders", { keyPath: "id" })
        }
      },
    })
  }
  return dbPromise
}

export async function getAll<T>(storeName: string): Promise<T[]> {
  const db = await getDb()
  return db.getAll(storeName)
}

export async function getById<T>(storeName: string, id: string | number): Promise<T | undefined> {
  const db = await getDb()
  return db.get(storeName, id)
}

export async function put<T>(storeName: string, value: T): Promise<void> {
  const db = await getDb()
  await db.put(storeName, value)
}

export async function putMany<T>(storeName: string, values: T[]): Promise<void> {
  const db = await getDb()
  const tx = db.transaction(storeName, "readwrite")
  await Promise.all([...values.map((v) => tx.store.put(v)), tx.done])
}

export async function del(storeName: string, id: string | number): Promise<void> {
  const db = await getDb()
  await db.delete(storeName, id)
}

export async function clear(storeName: string): Promise<void> {
  const db = await getDb()
  await db.clear(storeName)
}

export async function count(storeName: string): Promise<number> {
  const db = await getDb()
  return db.count(storeName)
}
