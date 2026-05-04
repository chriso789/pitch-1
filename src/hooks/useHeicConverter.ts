import { useState, useEffect } from 'react';
import heic2any from 'heic2any';
import { supabase } from '@/integrations/supabase/client';

const cache = new Map<string, string>();
const signedUrlCache = new Map<string, string>();

function isHeicUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return lower.includes('.heic') || lower.includes('.heif');
}

function parseSupabaseStorageUrl(url: string): { bucket: string; path: string } | null {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split('/').filter(Boolean);
    const objectIndex = parts.findIndex((part, index) => part === 'object' && parts[index - 1] === 'v1');
    const accessMode = objectIndex >= 0 ? parts[objectIndex + 1] : null;
    const bucket = objectIndex >= 0 ? parts[objectIndex + 2] : null;
    const path = objectIndex >= 0 ? parts.slice(objectIndex + 3).join('/') : null;

    if (!bucket || !path || !['public', 'authenticated', 'sign'].includes(accessMode || '')) return null;
    return { bucket, path };
  } catch {
    return null;
  }
}

async function resolveDisplayUrl(url: string): Promise<string> {
  if (signedUrlCache.has(url)) return signedUrlCache.get(url)!;

  const storageObject = parseSupabaseStorageUrl(url);
  if (!storageObject) return url;

  const { data, error } = await supabase.storage
    .from(storageObject.bucket)
    .createSignedUrl(storageObject.path, 60 * 60);

  if (error || !data?.signedUrl) return url;
  signedUrlCache.set(url, data.signedUrl);
  return data.signedUrl;
}

async function persistConvertedHeic(originalUrl: string, jpegBlob: Blob): Promise<string | null> {
  const storageObject = parseSupabaseStorageUrl(originalUrl);
  if (!storageObject) return null;

  const jpegPath = storageObject.path.replace(/\.(heic|heif)$/i, '.jpg');
  if (jpegPath === storageObject.path) return null;

  const { error: uploadError } = await supabase.storage
    .from(storageObject.bucket)
    .upload(jpegPath, jpegBlob, {
      cacheControl: '3600',
      contentType: 'image/jpeg',
      upsert: true,
    });

  if (uploadError) throw uploadError;

  const { data: publicData } = supabase.storage
    .from(storageObject.bucket)
    .getPublicUrl(jpegPath);

  await supabase
    .from('customer_photos')
    .update({
      file_url: publicData.publicUrl,
      file_name: jpegPath,
      mime_type: 'image/jpeg',
      file_size: jpegBlob.size,
      description: jpegPath.split('/').pop() || 'photo.jpg',
    })
    .eq('file_name', storageObject.path);

  const { data: signedData } = await supabase.storage
    .from(storageObject.bucket)
    .createSignedUrl(jpegPath, 60 * 60);

  if (signedData?.signedUrl) {
    signedUrlCache.set(publicData.publicUrl, signedData.signedUrl);
    return signedData.signedUrl;
  }

  return publicData.publicUrl;
}

/** Resolve private Supabase storage URLs and convert HEIC/HEIF URLs to displayable JPEG URLs. */
export async function getHeicDisplayUrl(url: string | undefined | null): Promise<string> {
  if (!url) return '';
  if (cache.has(url)) return cache.get(url)!;

  const resolvedUrl = await resolveDisplayUrl(url);

  if (!isHeicUrl(url)) {
    cache.set(url, resolvedUrl);
    return resolvedUrl;
  }

  const resp = await fetch(resolvedUrl);
  if (!resp.ok) throw new Error(`Fetch failed: ${resp.status}`);
  const blob = await resp.blob();
  const converted = await heic2any({ blob, toType: 'image/jpeg', quality: 0.85 });
  const jpegBlob = Array.isArray(converted) ? converted[0] : converted;
  const persistedUrl = await persistConvertedHeic(url, jpegBlob).catch((err) => {
    console.warn('[useHeicUrl] Converted display but could not persist JPEG:', err);
    return null;
  });
  const blobUrl = URL.createObjectURL(jpegBlob);
  const displayUrl = persistedUrl || blobUrl;
  cache.set(url, displayUrl);
  return displayUrl;
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
    if (cache.has(url)) { setDisplayUrl(cache.get(url)!); return; }

    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const safeUrl = await getHeicDisplayUrl(url);
        if (!cancelled) setDisplayUrl(safeUrl);
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
