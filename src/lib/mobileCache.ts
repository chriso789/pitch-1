import { openDB, IDBPDatabase } from 'idb';

const DB_NAME = 'pitchcrm-mobile-cache';
const DB_VERSION = 1;
const CACHE_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

export type CacheEntityType = 'jobs' | 'contacts' | 'appointments' | 'tasks' | 'notes' | 'documents';

export interface CachedRecord {
  id: string;
  entityType: CacheEntityType;
  data: any;
  cachedAt: number;
}

export interface PendingSyncItem {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  payload: any;
  createdAt: number;
  updatedAt?: string;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // Entity cache stores
        const entityTypes: CacheEntityType[] = ['jobs', 'contacts', 'appointments', 'tasks', 'notes', 'documents'];
        for (const type of entityTypes) {
          if (!db.objectStoreNames.contains(type)) {
            db.createObjectStore(type, { keyPath: 'id' });
          }
        }
        // Pending sync queue
        if (!db.objectStoreNames.contains('pendingSync')) {
          const store = db.createObjectStore('pendingSync', { keyPath: 'id' });
          store.createIndex('byCreatedAt', 'createdAt');
        }
      },
    });
  }
  return dbPromise;
}

export async function cacheRecord(entityType: CacheEntityType, id: string, data: any): Promise<void> {
  const db = await getDb();
  const record: CachedRecord = { id, entityType, data, cachedAt: Date.now() };
  await db.put(entityType, record);
}

export async function getCachedRecord(entityType: CacheEntityType, id: string): Promise<any | null> {
  const db = await getDb();
  const record = await db.get(entityType, id) as CachedRecord | undefined;
  if (!record) return null;
  if (Date.now() - record.cachedAt > CACHE_EXPIRY_MS) {
    await db.delete(entityType, id);
    return null;
  }
  return record.data;
}

export async function getCachedCollection(entityType: CacheEntityType): Promise<any[]> {
  const db = await getDb();
  const all = await db.getAll(entityType) as CachedRecord[];
  const now = Date.now();
  return all
    .filter(r => now - r.cachedAt <= CACHE_EXPIRY_MS)
    .map(r => r.data);
}

export async function markPendingSync(
  entityType: string,
  entityId: string,
  action: string,
  payload: any
): Promise<string> {
  const db = await getDb();
  const id = `${entityType}_${entityId}_${Date.now()}`;
  const item: PendingSyncItem = {
    id,
    entityType,
    entityId,
    action,
    payload,
    createdAt: Date.now(),
    updatedAt: payload?.updated_at,
  };
  await db.put('pendingSync', item);
  return id;
}

export async function getPendingSyncQueue(): Promise<PendingSyncItem[]> {
  const db = await getDb();
  const all = await db.getAllFromIndex('pendingSync', 'byCreatedAt') as PendingSyncItem[];
  return all;
}

export async function clearPendingSyncItem(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('pendingSync', id);
}

export async function clearAllMobileCache(): Promise<void> {
  const db = await getDb();
  const entityTypes: CacheEntityType[] = ['jobs', 'contacts', 'appointments', 'tasks', 'notes', 'documents'];
  const tx = db.transaction([...entityTypes, 'pendingSync'], 'readwrite');
  await Promise.all([
    ...entityTypes.map(t => tx.objectStore(t).clear()),
    tx.objectStore('pendingSync').clear(),
    tx.done,
  ]);
}

export async function getPendingSyncCount(): Promise<number> {
  const db = await getDb();
  return db.count('pendingSync');
}
