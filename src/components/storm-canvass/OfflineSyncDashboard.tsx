import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { 
  unifiedOfflineStore, 
  SyncProgress 
} from '@/services/unifiedOfflineStore';
import { useOfflineSync } from '@/hooks/useOfflineSync';
import {
  Cloud,
  CloudOff,
  RefreshCw,
  Trash2,
  Camera,
  Mic,
  MapPin,
  User,
  DoorOpen,
  CheckCircle,
  AlertCircle,
  Clock,
  HardDrive,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useToast } from '@/hooks/use-toast';

interface PendingCounts {
  photos: number;
  voiceNotes: number;
  dispositions: number;
  leads: number;
  doorKnocks: number;
}

export const OfflineSyncDashboard: React.FC = () => {
  const { isOnline, lastSyncAt } = useOfflineSync();
  const [pendingCounts, setPendingCounts] = useState<PendingCounts>({
    photos: 0,
    voiceNotes: 0,
    dispositions: 0,
    leads: 0,
    doorKnocks: 0,
  });
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const [storageUsage, setStorageUsage] = useState({ used: 0, available: 0 });
  const { toast } = useToast();

  useEffect(() => {
    loadPendingCounts();
    loadStorageUsage();

    const unsubscribe = unifiedOfflineStore.onSyncProgress((progress) => {
      setSyncProgress(progress);
    });

    const interval = setInterval(loadPendingCounts, 5000);
    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, []);

  const loadPendingCounts = async () => {
    try {
      const counts = await unifiedOfflineStore.getPendingCounts();
      setPendingCounts({
        photos: counts.photos || 0,
        voiceNotes: counts.voiceNotes || 0,
        dispositions: counts.dispositions || 0,
        leads: counts.leads || 0,
        doorKnocks: counts.doorKnocks || 0,
      });
    } catch (error) {
      console.error('Error loading pending counts:', error);
    }
  };

  const loadStorageUsage = async () => {
    const usage = await unifiedOfflineStore.getStorageUsage();
    setStorageUsage(usage);
  };

  const handleSync = async () => {
    if (!isOnline) {
      toast({
        title: 'Offline',
        description: 'Cannot sync while offline. Please connect to the internet.',
        variant: 'destructive',
      });
      return;
    }

    setIsSyncing(true);
    try {
      const result = await unifiedOfflineStore.syncAll();
      
      if (result.success > 0) {
        toast({
          title: 'Sync Complete',
          description: `${result.success} items synced successfully`,
        });
      }
      
      if (result.failed > 0) {
        toast({
          title: 'Some Items Failed',
          description: `${result.failed} items failed to sync`,
          variant: 'destructive',
        });
      }

      await loadPendingCounts();
      await loadStorageUsage();
    } catch (error: any) {
      toast({
        title: 'Sync Error',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsSyncing(false);
      setSyncProgress(null);
    }
  };

  const handleClearSynced = async () => {
    await unifiedOfflineStore.clearSyncedItems();
    await loadStorageUsage();
    toast({
      title: 'Cache Cleared',
      description: 'Synced items removed from local storage',
    });
  };

  const totalPending = Object.values(pendingCounts).reduce((a, b) => a + b, 0);
  const usedPercentage = storageUsage.available > 0 
    ? (storageUsage.used / storageUsage.available) * 100 
    : 0;

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const dataTypeConfig = [
    { key: 'leads', label: 'New Leads', icon: User, color: 'text-blue-500' },
    { key: 'dispositions', label: 'Dispositions', icon: MapPin, color: 'text-green-500' },
    { key: 'doorKnocks', label: 'Door Knocks', icon: DoorOpen, color: 'text-orange-500' },
    { key: 'photos', label: 'Photos', icon: Camera, color: 'text-purple-500' },
    { key: 'voiceNotes', label: 'Voice Notes', icon: Mic, color: 'text-pink-500' },
  ];

  return (
    <Card className="w-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            {isOnline ? (
              <Wifi className="h-5 w-5 text-green-500" />
            ) : (
              <WifiOff className="h-5 w-5 text-red-500" />
            )}
            Offline Sync
          </CardTitle>
          <Badge variant={isOnline ? 'default' : 'destructive'}>
            {isOnline ? 'Online' : 'Offline'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Connection Status */}
        <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
          <div className="flex items-center gap-2">
            {isOnline ? (
              <Cloud className="h-5 w-5 text-green-500" />
            ) : (
              <CloudOff className="h-5 w-5 text-muted-foreground" />
            )}
            <div>
              <p className="text-sm font-medium">
                {isOnline ? 'Connected' : 'Working Offline'}
              </p>
              {lastSyncAt && (
                <p className="text-xs text-muted-foreground">
                  Last sync: {formatDistanceToNow(lastSyncAt, { addSuffix: true })}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {totalPending > 0 && (
              <Badge variant="secondary" className="gap-1">
                <Clock className="h-3 w-3" />
                {totalPending} pending
              </Badge>
            )}
          </div>
        </div>

        {/* Pending Items */}
        <ScrollArea className="h-[200px]">
          <div className="space-y-2">
            {dataTypeConfig.map(({ key, label, icon: Icon, color }) => {
              const count = pendingCounts[key as keyof PendingCounts] || 0;
              const isSyncingThis = syncProgress?.type === key;
              
              return (
                <div
                  key={key}
                  className="flex items-center justify-between p-2 rounded-lg hover:bg-muted/50"
                >
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg bg-muted ${color}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">{label}</p>
                      {isSyncingThis && syncProgress && (
                        <p className="text-xs text-muted-foreground">
                          Syncing {syncProgress.completed}/{syncProgress.total}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {count === 0 ? (
                      <CheckCircle className="h-4 w-4 text-green-500" />
                    ) : (
                      <Badge variant="outline">{count}</Badge>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>

        {/* Sync Progress */}
        {isSyncing && syncProgress && (
          <div className="space-y-2">
            <Separator />
            <div className="p-3 rounded-lg bg-muted/50">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">
                  Syncing {syncProgress.type}...
                </span>
                <span className="text-sm text-muted-foreground">
                  {syncProgress.completed}/{syncProgress.total}
                </span>
              </div>
              <Progress 
                value={(syncProgress.completed / syncProgress.total) * 100} 
              />
              {syncProgress.failed > 0 && (
                <p className="text-xs text-destructive mt-1">
                  {syncProgress.failed} failed
                </p>
              )}
            </div>
          </div>
        )}

        {/* Storage Usage */}
        <div className="space-y-2">
          <Separator />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <HardDrive className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">Local Storage</span>
            </div>
            <span className="text-sm text-muted-foreground">
              {formatBytes(storageUsage.used)} / {formatBytes(storageUsage.available)}
            </span>
          </div>
          <Progress value={usedPercentage} className="h-2" />
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-2">
          <Button
            onClick={handleSync}
            disabled={!isOnline || isSyncing || totalPending === 0}
            className="flex-1"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isSyncing ? 'animate-spin' : ''}`} />
            {isSyncing ? 'Syncing...' : `Sync ${totalPending} Items`}
          </Button>
          <Button
            variant="outline"
            onClick={handleClearSynced}
            disabled={isSyncing}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>

        {/* Offline Warning */}
        {!isOnline && totalPending > 0 && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-yellow-500/10 text-yellow-600 dark:text-yellow-400">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            <p className="text-sm">
              {totalPending} items waiting to sync. They will upload automatically when you reconnect.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
