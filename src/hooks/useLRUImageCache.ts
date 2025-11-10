import { useRef, useCallback } from 'react';
import { FabricImage } from 'fabric';

interface CacheEntry {
  image: FabricImage;
  lastAccessed: number;
  url: string;
  size: number; // Approximate size in bytes
}

interface CacheStats {
  totalHits: number;
  totalMisses: number;
  totalEvictions: number;
}

interface UseLRUImageCacheOptions {
  maxSize?: number; // Maximum number of images to cache
}

export function useLRUImageCache(options: UseLRUImageCacheOptions = {}) {
  const { maxSize = 10 } = options; // Default to 10 images
  
  // Map of URL -> CacheEntry
  const cacheRef = useRef<Map<string, CacheEntry>>(new Map());
  
  // Statistics tracking
  const statsRef = useRef<CacheStats>({
    totalHits: 0,
    totalMisses: 0,
    totalEvictions: 0,
  });

  const getCacheStats = useCallback(() => {
    const cache = cacheRef.current;
    const stats = statsRef.current;
    
    const entries = Array.from(cache.entries()).map(([url, entry]) => ({
      url,
      lastAccessed: entry.lastAccessed,
      size: entry.size,
    }));
    
    // Calculate total memory usage
    const totalMemory = entries.reduce((sum, entry) => sum + entry.size, 0);
    
    // Calculate hit rate
    const totalRequests = stats.totalHits + stats.totalMisses;
    const hitRate = totalRequests > 0 ? (stats.totalHits / totalRequests) * 100 : 0;
    
    return {
      currentSize: cache.size,
      maxSize,
      totalMemoryBytes: totalMemory,
      totalMemoryMB: (totalMemory / (1024 * 1024)).toFixed(2),
      entries: entries.sort((a, b) => b.lastAccessed - a.lastAccessed),
      hits: stats.totalHits,
      misses: stats.totalMisses,
      evictions: stats.totalEvictions,
      hitRate: hitRate.toFixed(1),
      totalRequests,
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
      statsRef.current.totalEvictions++;
    }
  }, []);

  const getImage = useCallback((url: string): FabricImage | null => {
    const cache = cacheRef.current;
    const entry = cache.get(url);

    if (entry) {
      // Update last accessed time
      entry.lastAccessed = Date.now();
      statsRef.current.totalHits++;
      console.log(`[LRU Cache] Cache HIT for: ${url}`);
      return entry.image;
    }

    statsRef.current.totalMisses++;
    console.log(`[LRU Cache] Cache MISS for: ${url}`);
    return null;
  }, []);

  const setImage = useCallback((url: string, image: FabricImage) => {
    const cache = cacheRef.current;

    // If we're at capacity, evict the LRU entry
    if (cache.size >= maxSize && !cache.has(url)) {
      evictLRU();
    }

    // Estimate image size (approximate based on dimensions)
    const width = image.width || 800;
    const height = image.height || 600;
    const estimatedSize = width * height * 4; // 4 bytes per pixel (RGBA)

    // Add or update the entry
    cache.set(url, {
      image,
      lastAccessed: Date.now(),
      url,
      size: estimatedSize,
    });

    console.log(`[LRU Cache] Cached image: ${url} (${cache.size}/${maxSize})`);
  }, [maxSize, evictLRU]);

  const clearCache = useCallback(() => {
    console.log('[LRU Cache] Clearing all cached images');
    cacheRef.current.clear();
    // Reset statistics
    statsRef.current = {
      totalHits: 0,
      totalMisses: 0,
      totalEvictions: 0,
    };
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
