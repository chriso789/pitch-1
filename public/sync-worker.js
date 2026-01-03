// Background sync service worker for offline canvassing
const CACHE_NAME = 'canvass-offline-v1';
const SYNC_TAG = 'canvass-sync';

// Handle install
self.addEventListener('install', (event) => {
  console.log('[SyncWorker] Installing...');
  self.skipWaiting();
});

// Handle activate
self.addEventListener('activate', (event) => {
  console.log('[SyncWorker] Activating...');
  event.waitUntil(self.clients.claim());
});

// Handle background sync
self.addEventListener('sync', (event) => {
  console.log('[SyncWorker] Sync event:', event.tag);
  
  if (event.tag === SYNC_TAG || event.tag === 'canvass-background-sync') {
    event.waitUntil(syncOfflineData());
  }
});

// Handle periodic sync (if supported)
self.addEventListener('periodicsync', (event) => {
  console.log('[SyncWorker] Periodic sync:', event.tag);
  
  if (event.tag === 'canvass-periodic-sync') {
    event.waitUntil(syncOfflineData());
  }
});

// Main sync function
async function syncOfflineData() {
  console.log('[SyncWorker] Starting offline data sync...');
  
  try {
    // Open IndexedDB
    const db = await openDatabase();
    if (!db) {
      console.log('[SyncWorker] Database not available');
      return;
    }
    
    // Get all pending items from each store
    const stores = ['leads', 'dispositions', 'doorKnocks', 'photos', 'voiceNotes'];
    let totalSynced = 0;
    let totalFailed = 0;
    
    for (const storeName of stores) {
      try {
        const pendingItems = await getPendingItems(db, storeName);
        console.log(`[SyncWorker] Found ${pendingItems.length} pending ${storeName}`);
        
        for (const item of pendingItems) {
          try {
            // Attempt to sync the item
            const success = await syncItem(storeName, item);
            if (success) {
              // Remove from IndexedDB on success
              await removeItem(db, storeName, item.id);
              totalSynced++;
            } else {
              totalFailed++;
            }
          } catch (error) {
            console.error(`[SyncWorker] Failed to sync ${storeName} item:`, error);
            totalFailed++;
          }
        }
      } catch (error) {
        console.error(`[SyncWorker] Error processing ${storeName}:`, error);
      }
    }
    
    console.log(`[SyncWorker] Sync complete: ${totalSynced} synced, ${totalFailed} failed`);
    
    // Notify clients of sync completion
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
      client.postMessage({
        type: 'SYNC_COMPLETE',
        synced: totalSynced,
        failed: totalFailed,
      });
    });
    
    // Show notification if significant sync happened
    if (totalSynced > 0) {
      await showSyncNotification(totalSynced);
    }
    
  } catch (error) {
    console.error('[SyncWorker] Sync failed:', error);
  }
}

// Open the IndexedDB database
function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('unified-offline-store', 1);
    
    request.onerror = () => {
      console.error('[SyncWorker] Failed to open database');
      resolve(null);
    };
    
    request.onsuccess = () => {
      resolve(request.result);
    };
  });
}

// Get pending items from a store
function getPendingItems(db, storeName) {
  return new Promise((resolve, reject) => {
    try {
      const transaction = db.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);
      const index = store.index('by-status');
      const request = index.getAll('pending');
      
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => resolve([]);
    } catch (error) {
      resolve([]);
    }
  });
}

// Remove item from store after successful sync
function removeItem(db, storeName, id) {
  return new Promise((resolve, reject) => {
    try {
      const transaction = db.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.delete(id);
      
      request.onsuccess = () => resolve(true);
      request.onerror = () => resolve(false);
    } catch (error) {
      resolve(false);
    }
  });
}

// Sync individual item to server
async function syncItem(storeName, item) {
  // This is a simplified version - the main app's unified store handles the actual sync
  // The service worker triggers the sync, but the app logic does the heavy lifting
  return false; // Let the main app handle actual syncing
}

// Show notification when sync completes
async function showSyncNotification(count) {
  if (!self.registration.showNotification) return;
  
  try {
    await self.registration.showNotification('Canvass Data Synced', {
      body: `${count} item${count > 1 ? 's' : ''} synced successfully`,
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      tag: 'sync-complete',
      renotify: false,
    });
  } catch (error) {
    console.log('[SyncWorker] Could not show notification:', error);
  }
}

// Handle messages from the main app
self.addEventListener('message', (event) => {
  console.log('[SyncWorker] Message received:', event.data);
  
  if (event.data.type === 'TRIGGER_SYNC') {
    syncOfflineData();
  }
  
  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      // Focus existing window or open new one
      for (const client of clients) {
        if (client.url.includes('/storm-canvass') && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow('/storm-canvass/live');
      }
    })
  );
});
