import { openDB, DBSchema, IDBPDatabase } from 'idb';

// Types
interface Location {
  lat: number;
  lng: number;
}

interface DistanceCalculation {
  distance: number;
  unit: 'miles' | 'feet';
}

interface CachedRoute {
  id: string;
  origin: Location;
  destination: { lat: number; lng: number; address: string };
  distance: DistanceCalculation;
  duration: number;
  polyline?: string;
  steps?: any[];
  cachedAt: string;
  expiresAt: string;
  accessCount: number;
  lastAccessedAt: string;
}

export interface QueuedActivity {
  id?: string;
  type: 'door_knock' | 'disposition_update' | 'lead_create' | 'photo_upload' | 'measurement_save';
  payload: any;
  userLocation: Location | null;
  timestamp: string;
  retryCount?: number;
  status?: 'pending' | 'syncing' | 'failed';
  error?: string;
}

interface CachedContact {
  id: string;
  first_name: string;
  last_name: string;
  address_street: string;
  address_city?: string;
  address_state?: string;
  address_zip?: string;
  latitude: number;
  longitude: number;
  qualification_status?: string;
  phone?: string;
  email?: string;
  cachedAt: string;
  expiresAt: string;
}

interface CachedDisposition {
  id: string;
  name: string;
  is_positive?: boolean;
  color?: string;
  cachedAt: string;
  expiresAt: string;
}

interface SyncResult {
  success: number;
  failed: number;
  total: number;
}

interface StorageStats {
  routeCount: number;
  activityCount: number;
  contactCount: number;
  dispositionCount: number;
  totalSize: string;
}

interface CachedSatelliteImage {
  id: string;
  url: string;
  propertyId: string;
  lat: number;
  lng: number;
  zoom: number;
  blob: Blob;
  cachedAt: string;
  expiresAt: string;
  sizeBytes: number;
  accessCount: number;
  lastAccessedAt: string;
}

interface CachedMeasurement {
  id: string;
  propertyId: string;
  measurementData: any;
  satelliteImageId?: string;
  cachedAt: string;
  expiresAt: string;
}

// IndexedDB Schema
interface StormCanvassDB extends DBSchema {
  routes: {
    key: string;
    value: CachedRoute;
    indexes: { 'by-expires': string };
  };
  activityQueue: {
    key: string;
    value: QueuedActivity;
    indexes: { 'by-status': string; 'by-timestamp': string };
  };
  contacts: {
    key: string;
    value: CachedContact;
    indexes: { 'by-expires': string };
  };
  dispositions: {
    key: string;
    value: CachedDisposition;
    indexes: { 'by-expires': string };
  };
  satelliteImages: {
    key: string;
    value: CachedSatelliteImage;
    indexes: { 'by-expires': string; 'by-property': string };
  };
  measurements: {
    key: string;
    value: CachedMeasurement;
    indexes: { 'by-expires': string; 'by-property': string };
  };
}

class OfflineManager {
  private db: IDBPDatabase<StormCanvassDB> | null = null;
  private networkCallbacks: Set<(isOnline: boolean) => void> = new Set();
  private isOnlineState: boolean = navigator.onLine;
  private pingInterval: NodeJS.Timeout | null = null;

  // Initialize IndexedDB
  async initialize(): Promise<void> {
    if (this.db) return;

    this.db = await openDB<StormCanvassDB>('storm-canvass-offline', 2, {
      upgrade(db, oldVersion) {
        // Routes store
        if (!db.objectStoreNames.contains('routes')) {
          const routeStore = db.createObjectStore('routes', { keyPath: 'id' });
          routeStore.createIndex('by-expires', 'expiresAt');
        }

        // Activity queue store
        if (!db.objectStoreNames.contains('activityQueue')) {
          const activityStore = db.createObjectStore('activityQueue', { keyPath: 'id' });
          activityStore.createIndex('by-status', 'status');
          activityStore.createIndex('by-timestamp', 'timestamp');
        }

        // Contacts store
        if (!db.objectStoreNames.contains('contacts')) {
          const contactStore = db.createObjectStore('contacts', { keyPath: 'id' });
          contactStore.createIndex('by-expires', 'expiresAt');
        }

        // Dispositions store
        if (!db.objectStoreNames.contains('dispositions')) {
          const dispositionStore = db.createObjectStore('dispositions', { keyPath: 'id' });
          dispositionStore.createIndex('by-expires', 'expiresAt');
        }

        // Satellite images store (v2)
        if (oldVersion < 2 && !db.objectStoreNames.contains('satelliteImages')) {
          const imageStore = db.createObjectStore('satelliteImages', { keyPath: 'id' });
          imageStore.createIndex('by-expires', 'expiresAt');
          imageStore.createIndex('by-property', 'propertyId');
        }

        // Measurements store (v2)
        if (oldVersion < 2 && !db.objectStoreNames.contains('measurements')) {
          const measurementStore = db.createObjectStore('measurements', { keyPath: 'id' });
          measurementStore.createIndex('by-expires', 'expiresAt');
          measurementStore.createIndex('by-property', 'propertyId');
        }
      },
    });

    // Start network monitoring
    this.startNetworkMonitoring();

    // Clean up expired entries on initialization
    await this.clearExpiredEntries();
  }

  // Network Status Detection
  isOnline(): boolean {
    return this.isOnlineState;
  }

  watchNetworkStatus(callback: (isOnline: boolean) => void): () => void {
    this.networkCallbacks.add(callback);
    
    // Immediately call with current status
    callback(this.isOnlineState);

    // Return unsubscribe function
    return () => {
      this.networkCallbacks.delete(callback);
    };
  }

  private startNetworkMonitoring(): void {
    // Listen to browser online/offline events
    window.addEventListener('online', this.handleOnline);
    window.addEventListener('offline', this.handleOffline);

    // Periodic ping test when online (every 30 seconds)
    if (this.isOnlineState) {
      this.startPingTest();
    }
  }

  private handleOnline = (): void => {
    this.isOnlineState = true;
    this.notifyNetworkChange(true);
    this.startPingTest();
  };

  private handleOffline = (): void => {
    this.isOnlineState = false;
    this.notifyNetworkChange(false);
    this.stopPingTest();
  };

  private startPingTest(): void {
    this.stopPingTest(); // Clear any existing interval

    this.pingInterval = setInterval(async () => {
      try {
        // Try to fetch from Supabase (lightweight endpoint)
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

        const response = await fetch('https://alxelfrbjzkmtnsulcei.supabase.co/rest/v1/', {
          method: 'HEAD',
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok && this.isOnlineState) {
          // Network seems down
          this.isOnlineState = false;
          this.notifyNetworkChange(false);
        } else if (response.ok && !this.isOnlineState) {
          // Network is back
          this.isOnlineState = true;
          this.notifyNetworkChange(true);
        }
      } catch (error) {
        // Ping failed, mark as offline
        if (this.isOnlineState) {
          this.isOnlineState = false;
          this.notifyNetworkChange(false);
        }
      }
    }, 30000); // Every 30 seconds
  }

  private stopPingTest(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private notifyNetworkChange(isOnline: boolean): void {
    this.networkCallbacks.forEach(callback => {
      try {
        callback(isOnline);
      } catch (error) {
        console.error('Error in network status callback:', error);
      }
    });
  }

  // Route Caching
  async cacheRoute(routeData: Omit<CachedRoute, 'id' | 'accessCount' | 'lastAccessedAt'>): Promise<void> {
    await this.initialize();
    if (!this.db) return;

    const id = this.generateRouteId(routeData.origin, routeData.destination);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days

    const cachedRoute: CachedRoute = {
      ...routeData,
      id,
      expiresAt,
      accessCount: 0,
      lastAccessedAt: new Date().toISOString(),
    };

    await this.db.put('routes', cachedRoute);
  }

  async getCachedRoute(origin: Location, destination: Location): Promise<CachedRoute | null> {
    await this.initialize();
    if (!this.db) return null;

    const id = this.generateRouteId(origin, destination);
    const route = await this.db.get('routes', id);

    if (!route) return null;

    // Check if expired
    if (new Date(route.expiresAt) < new Date()) {
      await this.db.delete('routes', id);
      return null;
    }

    // Update access stats
    route.accessCount++;
    route.lastAccessedAt = new Date().toISOString();
    await this.db.put('routes', route);

    return route;
  }

  async clearExpiredRoutes(): Promise<void> {
    await this.initialize();
    if (!this.db) return;

    const now = new Date().toISOString();
    const tx = this.db.transaction('routes', 'readwrite');
    const index = tx.store.index('by-expires');

    let cursor = await index.openCursor(IDBKeyRange.upperBound(now));
    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }

    await tx.done;
  }

  private generateRouteId(origin: Location, destination: Location): string {
    return `${origin.lat.toFixed(6)}_${origin.lng.toFixed(6)}_${destination.lat.toFixed(6)}_${destination.lng.toFixed(6)}`;
  }

  // Activity Queue
  async queueActivity(activity: Omit<QueuedActivity, 'id' | 'retryCount' | 'status'>): Promise<void> {
    await this.initialize();
    if (!this.db) return;

    const queuedActivity: QueuedActivity = {
      ...activity,
      id: crypto.randomUUID(),
      retryCount: 0,
      status: 'pending',
    };

    await this.db.add('activityQueue', queuedActivity);
  }

  async getQueuedActivities(): Promise<QueuedActivity[]> {
    await this.initialize();
    if (!this.db) return [];

    return await this.db.getAllFromIndex('activityQueue', 'by-status', 'pending');
  }

  async removeQueuedActivity(id: string): Promise<void> {
    await this.initialize();
    if (!this.db) return;

    await this.db.delete('activityQueue', id);
  }

  async updateActivityStatus(id: string, status: QueuedActivity['status'], error?: string): Promise<void> {
    await this.initialize();
    if (!this.db) return;

    const activity = await this.db.get('activityQueue', id);
    if (activity) {
      activity.status = status;
      if (error) activity.error = error;
      if (status === 'syncing') {
        activity.retryCount = (activity.retryCount || 0) + 1;
      }
      await this.db.put('activityQueue', activity);
    }
  }

  async syncQueuedActivities(): Promise<SyncResult> {
    await this.initialize();
    if (!this.db) return { success: 0, failed: 0, total: 0 };

    const activities = await this.getQueuedActivities();
    let success = 0;
    let failed = 0;

    for (const activity of activities) {
      if ((activity.retryCount || 0) >= 3) {
        // Max retries reached
        await this.updateActivityStatus(activity.id!, 'failed', 'Max retry attempts reached');
        failed++;
        continue;
      }

      try {
        await this.updateActivityStatus(activity.id!, 'syncing');

        // Import supabase dynamically to avoid circular dependency
        const { supabase } = await import('@/integrations/supabase/client');

        switch (activity.type) {
          case 'door_knock':
            const { error: doorKnockError } = await supabase
              .from('canvass_activity_log')
              .insert(activity.payload);
            if (doorKnockError) throw doorKnockError;
            break;

          case 'disposition_update':
            const { error: dispositionError } = await supabase.functions.invoke('canvass-dispositions', {
              body: {
                contact_id: activity.payload.contact_id,
                disposition_id: activity.payload.disposition_id,
                notes: activity.payload.notes,
              },
            });
            if (dispositionError) throw dispositionError;
            break;

          default:
            throw new Error(`Unknown activity type: ${activity.type}`);
        }

        // Success - remove from queue
        await this.removeQueuedActivity(activity.id!);
        success++;
      } catch (error: any) {
        console.error('Sync error for activity:', activity.id, error);
        await this.updateActivityStatus(activity.id!, 'failed', error.message);
        failed++;
      }
    }

    return { success, failed, total: activities.length };
  }

  // Contact Caching
  async cacheContacts(contacts: CachedContact[]): Promise<void> {
    await this.initialize();
    if (!this.db) return;

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours

    const tx = this.db.transaction('contacts', 'readwrite');
    for (const contact of contacts) {
      await tx.store.put({
        ...contact,
        cachedAt: new Date().toISOString(),
        expiresAt,
      });
    }
    await tx.done;
  }

  async getCachedContacts(location: Location, radiusMiles: number): Promise<CachedContact[]> {
    await this.initialize();
    if (!this.db) return [];

    const allContacts = await this.db.getAll('contacts');
    const now = new Date().toISOString();

    // Filter by expiration and distance
    return allContacts.filter(contact => {
      if (contact.expiresAt < now) return false;

      const distance = this.calculateDistance(
        location.lat,
        location.lng,
        contact.latitude,
        contact.longitude
      );

      return distance <= radiusMiles;
    });
  }

  // Disposition Caching
  async cacheDispositions(dispositions: CachedDisposition[]): Promise<void> {
    await this.initialize();
    if (!this.db) return;

    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days

    const tx = this.db.transaction('dispositions', 'readwrite');
    for (const disposition of dispositions) {
      await tx.store.put({
        ...disposition,
        cachedAt: new Date().toISOString(),
        expiresAt,
      });
    }
    await tx.done;
  }

  async getCachedDispositions(): Promise<CachedDisposition[]> {
    await this.initialize();
    if (!this.db) return [];

    const allDispositions = await this.db.getAll('dispositions');
    const now = new Date().toISOString();

    // Filter expired
    return allDispositions.filter(d => d.expiresAt >= now);
  }

  // Satellite Image Caching
  async cacheSatelliteImage(
    url: string,
    propertyId: string,
    lat: number,
    lng: number,
    zoom: number
  ): Promise<string | null> {
    await this.initialize();
    if (!this.db) return null;

    try {
      // Fetch image as blob
      const response = await fetch(url);
      if (!response.ok) return null;
      
      const blob = await response.blob();
      const id = `sat_${propertyId}_${zoom}`;
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days

      await this.db.put('satelliteImages', {
        id,
        url,
        propertyId,
        lat,
        lng,
        zoom,
        blob,
        cachedAt: new Date().toISOString(),
        expiresAt,
        sizeBytes: blob.size,
        accessCount: 0,
        lastAccessedAt: new Date().toISOString(),
      });

      return URL.createObjectURL(blob);
    } catch (error) {
      console.error('Failed to cache satellite image:', error);
      return null;
    }
  }

  async getCachedSatelliteImage(propertyId: string, zoom: number): Promise<string | null> {
    await this.initialize();
    if (!this.db) return null;

    const id = `sat_${propertyId}_${zoom}`;
    const cached = await this.db.get('satelliteImages', id);

    if (!cached) return null;

    const now = new Date().toISOString();
    if (cached.expiresAt < now) {
      await this.db.delete('satelliteImages', id);
      return null;
    }

    // Update access count
    await this.db.put('satelliteImages', {
      ...cached,
      accessCount: cached.accessCount + 1,
      lastAccessedAt: now,
    });

    return URL.createObjectURL(cached.blob);
  }

  // Measurement Caching
  async cacheMeasurement(
    measurementId: string,
    propertyId: string,
    measurementData: any,
    satelliteImageId?: string
  ): Promise<void> {
    await this.initialize();
    if (!this.db) return;

    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days

    await this.db.put('measurements', {
      id: measurementId,
      propertyId,
      measurementData,
      satelliteImageId,
      cachedAt: new Date().toISOString(),
      expiresAt,
    });
  }

  async getCachedMeasurement(measurementId: string): Promise<any | null> {
    await this.initialize();
    if (!this.db) return null;

    const cached = await this.db.get('measurements', measurementId);
    if (!cached) return null;

    const now = new Date().toISOString();
    if (cached.expiresAt < now) {
      await this.db.delete('measurements', measurementId);
      return null;
    }

    return cached.measurementData;
  }

  async getCachedMeasurementsByProperty(propertyId: string): Promise<any[]> {
    await this.initialize();
    if (!this.db) return [];

    const index = this.db.transaction('measurements').store.index('by-property');
    const measurements = await index.getAll(propertyId);
    const now = new Date().toISOString();

    return measurements
      .filter(m => m.expiresAt >= now)
      .map(m => m.measurementData);
  }

  // Utilities
  async clearAllCache(): Promise<void> {
    await this.initialize();
    if (!this.db) return;

    await this.db.clear('routes');
    await this.db.clear('activityQueue');
    await this.db.clear('contacts');
    await this.db.clear('dispositions');
    await this.db.clear('satelliteImages');
    await this.db.clear('measurements');
  }

  async clearExpiredEntries(): Promise<void> {
    await this.clearExpiredRoutes();
    // Add similar methods for contacts and dispositions if needed
  }

  async getStorageStats(): Promise<StorageStats> {
    await this.initialize();
    if (!this.db) return { routeCount: 0, activityCount: 0, contactCount: 0, dispositionCount: 0, totalSize: '0 KB' };

    const routeCount = await this.db.count('routes');
    const activityCount = await this.db.count('activityQueue');
    const contactCount = await this.db.count('contacts');
    const dispositionCount = await this.db.count('dispositions');

    // Estimate storage size (rough approximation)
    const estimatedSize = (routeCount * 5 + activityCount * 2 + contactCount * 1 + dispositionCount * 0.5) * 1024;
    const totalSize = estimatedSize > 1024 * 1024 
      ? `${(estimatedSize / (1024 * 1024)).toFixed(2)} MB`
      : `${(estimatedSize / 1024).toFixed(2)} KB`;

    return { routeCount, activityCount, contactCount, dispositionCount, totalSize };
  }

  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 3959; // Earth radius in miles
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private toRad(degrees: number): number {
    return degrees * (Math.PI / 180);
  }

  // Cleanup on app close/logout
  destroy(): void {
    this.stopPingTest();
    window.removeEventListener('online', this.handleOnline);
    window.removeEventListener('offline', this.handleOffline);
    this.networkCallbacks.clear();
  }
}

// Export singleton instance
export const offlineManager = new OfflineManager();
