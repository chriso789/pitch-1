import { supabase } from '@/integrations/supabase/client';

/**
 * Get a signed URL for a PDF in any workspace bucket.
 */
export async function getPdfSignedUrl(bucket: string, path: string, expiresIn = 3600): Promise<string> {
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, expiresIn);

  if (error || !data?.signedUrl) {
    throw new Error(`Failed to get signed URL: ${error?.message || 'unknown'}`);
  }

  return data.signedUrl;
}
