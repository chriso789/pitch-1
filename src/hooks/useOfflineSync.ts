import { useState, useEffect, useCallback, useRef } from 'react';
import { offlineManager, QueuedActivity } from '@/services/offlineManager';
import { useToast } from '@/hooks/use-toast';

interface UseOfflineSyncResult {
  isOnline: boolean;
  pendingCount: number;
  isSyncing: boolean;
  lastSyncAt: Date | null;
  syncNow: () => Promise<void>;
  queueActivity: (activity: Omit<QueuedActivity, 'id' | 'retryCount' | 'status'>) => Promise<void>;
  clearQueue: () => Promise<void>;
}

export const useOfflineSync = (): UseOfflineSyncResult => {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);
  const { toast } = useToast();
  
  // Track consecutive failed pings - require 2 failures before marking offline
  const consecutiveFailures = useRef(0);
  const FAILURES_REQUIRED = 2;

  // Watch network status with improved detection
  useEffect(() => {
    const unwatch = offlineManager.watchNetworkStatus((online) => {
      if (online) {
        // Reset failure counter on successful connection
        consecutiveFailures.current = 0;
        
        const wasOffline = !isOnline;
        setIsOnline(true);

        if (wasOffline) {
          // Coming back online - auto-sync
          toast({
            title: 'Back Online',
            description: 'Syncing queued activities...',
          });
          syncNow();
        }
      } else {
        // Increment failure counter
        consecutiveFailures.current += 1;
        
        // Only mark offline after FAILURES_REQUIRED consecutive failures
        if (consecutiveFailures.current >= FAILURES_REQUIRED && isOnline) {
          setIsOnline(false);
          toast({
            title: 'You\'re Offline',
            description: 'Activities will be queued and synced when connection is restored',
            variant: 'default',
          });
        }
      }
    });

    return unwatch;
  }, [isOnline]);

  // Update pending count
  useEffect(() => {
    const updateCount = async () => {
      const activities = await offlineManager.getQueuedActivities();
      setPendingCount(activities.length);
    };

    updateCount();

    // Poll every 5 seconds
    const interval = setInterval(updateCount, 5000);
    return () => clearInterval(interval);
  }, [isSyncing]);

  const syncNow = useCallback(async () => {
    if (!isOnline || isSyncing) return;

    setIsSyncing(true);
    try {
      const result = await offlineManager.syncQueuedActivities();

      if (result.success > 0) {
        toast({
          title: 'Sync Complete',
          description: `${result.success} ${result.success === 1 ? 'activity' : 'activities'} synced successfully`,
        });
      }

      if (result.failed > 0) {
        toast({
          title: 'Sync Partial',
          description: `${result.failed} ${result.failed === 1 ? 'activity' : 'activities'} failed to sync`,
          variant: 'destructive',
        });
      }

      if (result.success === 0 && result.failed === 0) {
        toast({
          title: 'Nothing to Sync',
          description: 'No pending activities found',
        });
      }

      setLastSyncAt(new Date());

      // Update pending count immediately after sync
      const activities = await offlineManager.getQueuedActivities();
      setPendingCount(activities.length);
    } catch (error: any) {
      console.error('Sync error:', error);
      toast({
        title: 'Sync Failed',
        description: error.message || 'Could not sync queued activities',
        variant: 'destructive',
      });
    } finally {
      setIsSyncing(false);
    }
  }, [isOnline, isSyncing, toast]);

  const queueActivity = useCallback(async (activity: Omit<QueuedActivity, 'id' | 'retryCount' | 'status'>) => {
    await offlineManager.queueActivity(activity);
    setPendingCount(prev => prev + 1);

    if (isOnline) {
      // Try immediate sync if online
      await syncNow();
    } else {
      toast({
        title: 'Activity Queued',
        description: 'Activity will sync when connection is restored',
      });
    }
  }, [isOnline, syncNow, toast]);

  const clearQueue = useCallback(async () => {
    await offlineManager.clearAllCache();
    setPendingCount(0);
    toast({
      title: 'Cache Cleared',
      description: 'All cached data and queued activities have been cleared',
    });
  }, [toast]);

  return {
    isOnline,
    pendingCount,
    isSyncing,
    lastSyncAt,
    syncNow,
    queueActivity,
    clearQueue,
  };
};
