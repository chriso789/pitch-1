import { useRef, useCallback } from 'react';
import { FabricImage } from 'fabric';

interface CacheEntry {
  image: FabricImage;
  lastAccessed: number;
  url: string;
}

interface UseLRUImageCacheOptions {
  maxSize?: number; // Maximum number of images to cache
}

export function useLRUImageCache(options: UseLRUImageCacheOptions = {}) {
  const { maxSize = 10 } = options; // Default to 10 images
  
  // Map of URL -> CacheEntry
  const cacheRef = useRef<Map<string, CacheEntry>>(new Map());

  const getCacheStats = useCallback(() => {
    const cache = cacheRef.current;
    return {
      size: cache.size,
      maxSize,
      urls: Array.from(cache.keys()),
      totalEntries: cache.size,
    };
  }, [maxSize]);

  const evictLRU = useCallback(() => {
    const cache = cacheRef.current;
    if (cache.size === 0) return;

    // Find the least recently used entry
    let lruUrl: string | null = null;
    let oldestTime = Infinity;

    cache.forEach((entry, url) => {
      if (entry.lastAccessed < oldestTime) {
        oldestTime = entry.lastAccessed;
        lruUrl = url;
      }
    });

    if (lruUrl) {
      console.log(`[LRU Cache] Evicting least recently used image: ${lruUrl}`);
      cache.delete(lruUrl);
    }
  }, []);

  const getImage = useCallback((url: string): FabricImage | null => {
    const cache = cacheRef.current;
    const entry = cache.get(url);

    if (entry) {
      // Update last accessed time
      entry.lastAccessed = Date.now();
      console.log(`[LRU Cache] Cache HIT for: ${url}`);
      return entry.image;
    }

    console.log(`[LRU Cache] Cache MISS for: ${url}`);
    return null;
  }, []);

  const setImage = useCallback((url: string, image: FabricImage) => {
    const cache = cacheRef.current;

    // If we're at capacity, evict the LRU entry
    if (cache.size >= maxSize && !cache.has(url)) {
      evictLRU();
    }

    // Add or update the entry
    cache.set(url, {
      image,
      lastAccessed: Date.now(),
      url,
    });

    console.log(`[LRU Cache] Cached image: ${url} (${cache.size}/${maxSize})`);
  }, [maxSize, evictLRU]);

  const clearCache = useCallback(() => {
    console.log('[LRU Cache] Clearing all cached images');
    cacheRef.current.clear();
  }, []);

  const removeImage = useCallback((url: string) => {
    const cache = cacheRef.current;
    if (cache.has(url)) {
      console.log(`[LRU Cache] Removing image: ${url}`);
      cache.delete(url);
    }
  }, []);

  return {
    getImage,
    setImage,
    clearCache,
    removeImage,
    getCacheStats,
  };
}
