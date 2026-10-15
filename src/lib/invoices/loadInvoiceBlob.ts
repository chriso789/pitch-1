import { supabase } from '@/integrations/supabase/client';

/** Parse bucket + path from a Supabase storage URL or a raw project-invoices path. */
export function parseStorageRef(value: string): { bucket: string; path: string } | null {
  if (!value) return null;
  const m = value.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+?)(?:\?|$)/);
  if (m) return { bucket: m[1], path: decodeURIComponent(m[2]) };
  if (!/^https?:\/\//i.test(value) && !value.startsWith('/') && !value.startsWith('blob:')) {
    return { bucket: 'project-invoices', path: value };
  }
  return null;
}

/**
 * Download the file through the app and return a local blob: URL, so the
 * browser never navigates to the storage hostname (which ad/privacy
 * blockers often block with ERR_BLOCKED_BY_CLIENT).
 */
export async function loadInvoiceBlobUrl(urlOrPath: string): Promise<{ url: string; type: string }> {
  const ref = parseStorageRef(urlOrPath);
  let blob: Blob;
  if (ref) {
    const { data, error } = await supabase.storage.from(ref.bucket).download(ref.path);
    if (error || !data) throw new Error(error?.message || 'Could not load file');
    blob = data;
  } else {
    const res = await fetch(urlOrPath);
    if (!res.ok) throw new Error('Could not load file');
    blob = await res.blob();
  }
  const lower = (ref?.path || urlOrPath).toLowerCase();
  let type = blob.type;
  if (!type || type === 'application/octet-stream') {
    if (lower.includes('.pdf')) type = 'application/pdf';
    else if (/\.(png)/.test(lower)) type = 'image/png';
    else if (/\.(jpe?g)/.test(lower)) type = 'image/jpeg';
    else if (/\.webp/.test(lower)) type = 'image/webp';
  }
  const typed = blob.type === type ? blob : new Blob([blob], { type });
  return { url: URL.createObjectURL(typed), type };
}
