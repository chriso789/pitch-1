import { supabase } from '@/integrations/supabase/client';

/** Authenticated originals read through Storage; no public bucket assumption. */
export async function loadReportImage(tenantId: string, path: string, maxDimension = 1800): Promise<Uint8Array> {
  if (path.split('/')[0] !== tenantId) throw new Error('This photograph does not belong to the selected company.');
  const { data, error } = await supabase.storage.from('customer-photos').download(path);
  if (error || !data) throw new Error('Original photograph could not be loaded.');
  if (data.size > 25 * 1024 * 1024) throw new Error('Original photograph exceeds the 25 MB export limit.');
  const bitmap = await createImageBitmap(data);
  try {
    const s = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * s));
    canvas.height = Math.max(1, Math.round(bitmap.height * s));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Photograph preparation failed.');
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    canvas.width = 0; canvas.height = 0;
    if (!blob) throw new Error('Photograph preparation failed.');
    return new Uint8Array(await blob.arrayBuffer());
  } finally { bitmap.close(); }
}