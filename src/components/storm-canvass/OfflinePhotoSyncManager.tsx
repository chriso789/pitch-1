import React, { useEffect, useState, useRef } from 'react';
import { Cloud, CloudOff, Upload, Check, AlertCircle, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { queueForSession, retainFailedPhoto } from '@/lib/canvass/offlinePhotoRecovery';
import { uploadCanvassPhoto } from '@/lib/canvass/canvassPhotos';

interface OfflinePhoto {
  id: string;
  blob: Blob;
  fileName: string;
  category: string;
  propertyId?: string;
  propertyAddress?: string;
  latitude: number | null;
  longitude: number | null;
  notes?: string;
  timestamp: string;
  tenantId: string;
  userId: string;
  retryCount: number;
}

interface PhotoDB extends DBSchema {
  offlinePhotos: {
    key: string;
    value: OfflinePhoto;
    indexes: { 'by-timestamp': string };
  };
}

let db: IDBPDatabase<PhotoDB> | null = null;

async function getDB(): Promise<IDBPDatabase<PhotoDB>> {
  if (db) return db;
  
  db = await openDB<PhotoDB>('canvass-photos', 1, {
    upgrade(database) {
      const store = database.createObjectStore('offlinePhotos', { keyPath: 'id' });
      store.createIndex('by-timestamp', 'timestamp');
    },
  });
  
  return db;
}

interface OfflinePhotoSyncManagerProps {
  className?: string;
  compact?: boolean;
}

export function OfflinePhotoSyncManager({ className, compact = false }: OfflinePhotoSyncManagerProps) {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingPhotos, setPendingPhotos] = useState<OfflinePhoto[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);
  const { toast } = useToast();
  const { user } = useAuth();
  const tenantId = useEffectiveTenantId();
  const syncingRef = useRef(false);

  // Monitor online status
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);

    };
    
    const handleOffline = () => setIsOnline(false);
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (isOnline && tenantId && user?.id) void syncPhotos();
  }, [isOnline, tenantId, user?.id]);

  // Load pending photos count
  useEffect(() => {
    loadPendingPhotos();
    
    // Check for pending photos periodically
    const interval = setInterval(loadPendingPhotos, 30000);
    return () => clearInterval(interval);
  }, [tenantId, user?.id]);

  const loadPendingPhotos = async () => {
    try {
      const database = await getDB();
      const photos = await database.getAll('offlinePhotos');
      setPendingPhotos(tenantId && user?.id ? queueForSession(photos, tenantId, user.id) : []);
    } catch (err) {
      console.error('Error loading offline photos:', err);
    }
  };

  const syncPhotos = async () => {
    if (!navigator.onLine || syncingRef.current || !tenantId || !user?.id) return;
    syncingRef.current = true;
    
    setIsSyncing(true);
    setSyncProgress(0);
    
    const database = await getDB();
    const queued = queueForSession(await database.getAll('offlinePhotos'), tenantId, user.id);
    let successCount = 0;
    let failCount = 0;
    
    for (let i = 0; i < queued.length; i++) {
      const photo = queued[i];
      
      try {
        // Upload to the private canvass-photos bucket and persist the
        // photo record (canvass_photos) + activity log entry.
        await uploadCanvassPhoto({
          blob: photo.blob,
          tenantId: photo.tenantId,
          userId: photo.userId,
          propertyId: photo.propertyId ?? null,
          propertyAddress: photo.propertyAddress ?? null,
          category: photo.category,
          notes: photo.notes,
          latitude: photo.latitude ?? null,
          longitude: photo.longitude ?? null,
          fileName: photo.fileName,
          takenAt: photo.timestamp,
        });
        
        // Remove from IndexedDB
        await database.delete('offlinePhotos', photo.id);
        successCount++;
        
      } catch (err) {
        console.error('Failed to sync photo:', err);
        
        // Increment retry count
        const updatedPhoto = retainFailedPhoto(photo);
        
        await database.put('offlinePhotos', updatedPhoto);
        failCount++;
      }
      
      setSyncProgress(((i + 1) / queued.length) * 100);
    }
    
    setIsSyncing(false);
    syncingRef.current = false;
    await loadPendingPhotos();
    
    if (successCount > 0) {
      toast({
        title: 'Photos Synced',
        description: `${successCount} photo${successCount > 1 ? 's' : ''} uploaded successfully`,
      });
    }
    
    if (failCount > 0) {
      toast({
        title: 'Sync Issues',
        description: `${failCount} photo${failCount > 1 ? 's' : ''} retained for retry`,
        variant: 'destructive',
      });
    }
  };

  // Compact view for header/toolbar
  if (compact) {
    if (pendingPhotos.length === 0 && isOnline) {
      return null; // Hide when nothing to show
    }
    
    return (
      <Badge 
        variant={isOnline ? 'secondary' : 'destructive'} 
        className={className}
        onClick={syncPhotos}
      >
        {!isOnline ? (
          <>
            <CloudOff className="h-3 w-3 mr-1" />
            Offline
          </>
        ) : isSyncing ? (
          <>
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            Syncing...
          </>
        ) : pendingPhotos.length > 0 ? (
          <>
            <Upload className="h-3 w-3 mr-1" />
            {pendingPhotos.length} pending
          </>
        ) : (
          <>
            <Check className="h-3 w-3 mr-1" />
            Synced
          </>
        )}
      </Badge>
    );
  }

  // Full status card
  return (
    <div className={className}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isOnline ? (
            <Cloud className="h-4 w-4 text-green-500" />
          ) : (
            <CloudOff className="h-4 w-4 text-destructive" />
          )}
          <span className="text-sm font-medium">
            {isOnline ? 'Online' : 'Offline'}
          </span>
        </div>
        
        {pendingPhotos.length > 0 && (
          <Badge variant="secondary">
            {pendingPhotos.length} pending upload{pendingPhotos.length > 1 ? 's' : ''}
          </Badge>
        )}
      </div>
      
      {isSyncing && (
        <div className="mt-2">
          <Progress value={syncProgress} className="h-2" />
          <p className="text-xs text-muted-foreground mt-1">
            Uploading photos... {Math.round(syncProgress)}%
          </p>
        </div>
      )}
      
      {!isSyncing && pendingPhotos.length > 0 && isOnline && (
        <Button
          variant="outline"
          size="sm"
          className="w-full mt-2"
          onClick={syncPhotos}
        >
          <Upload className="h-4 w-4 mr-2" />
          Sync Now
        </Button>
      )}
      
      {!isOnline && pendingPhotos.length > 0 && (
        <p className="text-xs text-muted-foreground mt-2">
          <AlertCircle className="h-3 w-3 inline mr-1" />
          Photos will sync when you're back online
        </p>
      )}
    </div>
  );
}

// Export function to save photos offline
export async function savePhotoOffline(photo: Omit<OfflinePhoto, 'id' | 'retryCount'>): Promise<string> {
  const database = await getDB();
  const id = crypto.randomUUID();
  
  await database.add('offlinePhotos', {
    ...photo,
    id,
    retryCount: 0,
  });
  
  return id;
}

// Export function to count queued offline photos (used by capture dialogs)
export async function getPendingPhotoCount(): Promise<number> {
  try {
    const database = await getDB();
    return await database.count('offlinePhotos');
  } catch (err) {
    console.error('Error counting pending photos:', err);
    return 0;
  }
}
