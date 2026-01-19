// ============================================
// SUPABASE STORAGE UTILITIES
// ============================================

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

/**
 * Upload binary data to Supabase Storage
 */
export async function uploadBytes(
  sb: SupabaseClient,
  args: {
    bucket: string;
    path: string;
    bytes: Uint8Array;
    contentType: string;
  }
): Promise<void> {
  const { error } = await sb.storage.from(args.bucket).upload(args.path, args.bytes, {
    contentType: args.contentType,
    upsert: true,
  });
  
  if (error) {
    throw new Error(`Storage upload failed: ${error.message}`);
  }
}

/**
 * Generate a signed URL for downloading a file
 */
export async function signedUrlForPath(
  sb: SupabaseClient,
  args: {
    bucket: string;
    path: string;
    expiresInSec: number;
  }
): Promise<string> {
  const { data, error } = await sb.storage
    .from(args.bucket)
    .createSignedUrl(args.path, args.expiresInSec);
  
  if (error) {
    throw new Error(`Signed URL failed: ${error.message}`);
  }
  
  return data.signedUrl;
}

/**
 * Get public URL for a file (if bucket is public)
 */
export function getPublicUrl(
  sb: SupabaseClient,
  bucket: string,
  path: string
): string {
  const { data } = sb.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

/**
 * Delete a file from storage
 */
export async function deleteFile(
  sb: SupabaseClient,
  bucket: string,
  path: string
): Promise<void> {
  const { error } = await sb.storage.from(bucket).remove([path]);
  
  if (error) {
    throw new Error(`Storage delete failed: ${error.message}`);
  }
}
