/**
 * Service Worker for Static Asset Caching
 * Phase 5: Frontend Performance
 * 
 * Caches static assets for offline access and faster loading.
 * Critical for field workers with intermittent connectivity.
 */

const CACHE_NAME = 'pitch-crm-v1';

// Static assets to cache on install
const STATIC_ASSETS = [
  '/index.html',
  '/notification.mp3',
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  console.log('[ServiceWorker] Install');
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[ServiceWorker] Caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => self.skipWaiting())
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[ServiceWorker] Activate');
  
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME)
            .map((name) => {
              console.log('[ServiceWorker] Deleting old cache:', name);
              return caches.delete(name);
            })
        );
      })
      .then(() => self.clients.claim())
  );
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  
  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }
  
  // Skip API requests (let them go to network)
  if (url.pathname.startsWith('/functions/') || 
      url.pathname.startsWith('/rest/') ||
      url.pathname.startsWith('/auth/')) {
    return;
  }
  
  // Cache-first strategy for static assets
  if (request.destination === 'image' || 
      request.destination === 'font' ||
      url.pathname.startsWith('/assets/') ||
      url.pathname.endsWith('.js') ||
      url.pathname.endsWith('.css')) {
    
    event.respondWith(
      caches.match(request)
        .then((cachedResponse) => {
          if (cachedResponse) {
            // Return cached response and update cache in background
            event.waitUntil(
              fetch(request)
                .then((networkResponse) => {
                  if (networkResponse.ok) {
                    caches.open(CACHE_NAME)
                      .then((cache) => cache.put(request, networkResponse));
                  }
                })
                .catch(() => {}) // Ignore network errors
            );
            return cachedResponse;
          }
          
          // Not in cache - fetch and cache
          return fetch(request)
            .then((networkResponse) => {
              if (networkResponse.ok) {
                const responseToCache = networkResponse.clone();
                caches.open(CACHE_NAME)
                  .then((cache) => cache.put(request, responseToCache));
              }
              return networkResponse;
            });
        })
    );
    return;
  }
  
  // Network-first for HTML pages
  if (request.destination === 'document') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Cache successful responses
          if (response.ok) {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME)
              .then((cache) => cache.put(request, responseToCache));
          }
          return response;
        })
        .catch(() => {
          // Fallback to cache if offline
          return caches.match(request)
            .then((cachedResponse) => cachedResponse || caches.match('/index.html'));
        })
    );
    return;
  }
});

// Handle messages from main thread
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
});
