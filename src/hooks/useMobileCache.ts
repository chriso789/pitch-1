import { useState, useEffect, useCallback } from 'react';
import {
  getCachedCollection,
  cacheRecord,
  getPendingSyncCount,
  markPendingSync,
  type CacheEntityType,
} from '@/lib/mobileCache';
import { startNetworkMonitor, processQueue } from '@/lib/mobileSyncManager';

interface UseMobileCacheResult<T> {
  data: T[];
  isOffline: boolean;
  pendingCount: number;
  refreshCache: (freshData: T[]) => Promise<void>;
  queueSync: (entityId: string, action: string, payload: any) => Promise<void>;
  syncNow: () => Promise<void>;
}

export function useMobileCache<T extends { id: string }>(
  entityType: CacheEntityType
): UseMobileCacheResult<T> {
  const [data, setData] = useState<T[]>([]);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);

  // Network status
  useEffect(() => {
    const onOnline = () => setIsOffline(false);
    const onOffline = () => setIsOffline(true);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  // Load cached data
  useEffect(() => {
    getCachedCollection(entityType).then(cached => {
      if (cached.length > 0) setData(cached as T[]);
    });
  }, [entityType]);

  // Pending count + network monitor
  useEffect(() => {
    getPendingSyncCount().then(setPendingCount);
    const cleanup = startNetworkMonitor(async () => {
      const count = await getPendingSyncCount();
      setPendingCount(count);
    });
    return cleanup;
  }, []);

  const refreshCache = useCallback(async (freshData: T[]) => {
    setData(freshData);
    await Promise.all(freshData.map(item => cacheRecord(entityType, item.id, item)));
  }, [entityType]);

  const queueSync = useCallback(async (entityId: string, action: string, payload: any) => {
    await markPendingSync(entityType, entityId, action, payload);
    setPendingCount(prev => prev + 1);
  }, [entityType]);

  const syncNow = useCallback(async () => {
    await processQueue();
    const count = await getPendingSyncCount();
    setPendingCount(count);
  }, []);

  return { data, isOffline, pendingCount, refreshCache, queueSync, syncNow };
}
