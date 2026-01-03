import React, { useEffect, useState } from 'react';
import { Cloud, CloudOff, Upload, Check, AlertCircle, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { useToast } from '@/hooks/use-toast';

interface OfflinePhoto {
  id: string;
  blob: Blob;
  fileName: string;
  category: string;
  propertyId?: string;
  propertyAddress?: string;
  latitude: number;
  longitude: number;
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

  // Monitor online status
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      // Auto-sync when coming online
      syncPhotos();
    };
    
    const handleOffline = () => setIsOnline(false);
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Load pending photos count
  useEffect(() => {
    loadPendingPhotos();
    
    // Check for pending photos periodically
    const interval = setInterval(loadPendingPhotos, 30000);
    return () => clearInterval(interval);
  }, []);

  const loadPendingPhotos = async () => {
    try {
      const database = await getDB();
      const photos = await database.getAll('offlinePhotos');
      setPendingPhotos(photos);
    } catch (err) {
      console.error('Error loading offline photos:', err);
    }
  };

  const syncPhotos = async () => {
    if (!isOnline || isSyncing || pendingPhotos.length === 0) return;
    
    setIsSyncing(true);
    setSyncProgress(0);
    
    const database = await getDB();
    let successCount = 0;
    let failCount = 0;
    
    for (let i = 0; i < pendingPhotos.length; i++) {
      const photo = pendingPhotos[i];
      
      try {
        // Upload to Supabase Storage
        const fileName = `${photo.tenantId}/${photo.userId}/${Date.now()}_${photo.fileName}`;
        
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('canvass-photos')
          .upload(fileName, photo.blob, {
            contentType: 'image/jpeg',
            upsert: false,
          });
        
        if (uploadError) throw uploadError;
        
        // Get public URL
        const { data: urlData } = supabase.storage
          .from('canvass-photos')
          .getPublicUrl(fileName);
        
        // Log activity for the photo capture
        await supabase.from('canvass_activity_log').insert({
          tenant_id: photo.tenantId,
          user_id: photo.userId,
          activity_type: 'photo_captured',
          latitude: photo.latitude,
          longitude: photo.longitude,
          activity_data: {
            file_url: urlData.publicUrl,
            file_name: photo.fileName,
            category: photo.category,
            property_id: photo.propertyId,
            property_address: photo.propertyAddress,
            captured_at: photo.timestamp,
            synced_at: new Date().toISOString(),
          },
        });
        
        // Remove from IndexedDB
        await database.delete('offlinePhotos', photo.id);
        successCount++;
        
      } catch (err) {
        console.error('Failed to sync photo:', err);
        
        // Increment retry count
        const updatedPhoto = { ...photo, retryCount: photo.retryCount + 1 };
        
        if (updatedPhoto.retryCount >= 3) {
          // Remove after 3 failed attempts
          await database.delete('offlinePhotos', photo.id);
          failCount++;
        } else {
          await database.put('offlinePhotos', updatedPhoto);
        }
      }
      
      setSyncProgress(((i + 1) / pendingPhotos.length) * 100);
    }
    
    setIsSyncing(false);
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
        description: `${failCount} photo${failCount > 1 ? 's' : ''} failed after multiple attempts`,
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
