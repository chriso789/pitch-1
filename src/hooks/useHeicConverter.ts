import { useState, useEffect } from 'react';
import heic2any from 'heic2any';

const cache = new Map<string, string>();

function isHeicUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return lower.includes('.heic') || lower.includes('.heif');
}

/**
 * Converts a HEIC/HEIF URL to a displayable blob URL.
 * Returns the original URL for non-HEIC files.
 * Caches results to avoid re-downloading.
 */
export function useHeicUrl(url: string | undefined | null): { displayUrl: string; loading: boolean } {
  const [displayUrl, setDisplayUrl] = useState<string>(url || '');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!url) { setDisplayUrl(''); return; }
    if (!isHeicUrl(url)) { setDisplayUrl(url); return; }
    if (cache.has(url)) { setDisplayUrl(cache.get(url)!); return; }

    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`Fetch failed: ${resp.status}`);
        const blob = await resp.blob();
        const converted = await heic2any({ blob, toType: 'image/jpeg', quality: 0.85 });
        const jpegBlob = Array.isArray(converted) ? converted[0] : converted;
        const blobUrl = URL.createObjectURL(jpegBlob);
        cache.set(url, blobUrl);
        if (!cancelled) setDisplayUrl(blobUrl);
      } catch (err) {
        console.warn('[useHeicUrl] Conversion failed, falling back:', err);
        if (!cancelled) setDisplayUrl(url);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [url]);

  return { displayUrl, loading };
}
