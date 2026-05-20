import { supabase } from '@/integrations/supabase/client';

/**
 * Tenant-safe wrapper around supabase.storage.from(bucket).upload().
 *
 * Enforces the project-wide convention that EVERY uploaded file's storage path
 * starts with the active tenant_id as the first folder segment.
 *
 * This is the runtime defense-in-depth layer on top of storage RLS policies —
 * it fails fast in the client with a clear error if a caller accidentally
 * builds a path without the tenant prefix (which would either land in the
 * wrong tenant's namespace or be rejected by RLS with a confusing error).
 *
 * Usage:
 *   await safeStorageUpload({
 *     bucket: 'documents',
 *     path: `${tenantId}/projects/${projectId}/foo.pdf`,
 *     file,
 *     tenantId,
 *   });
 */
export async function safeStorageUpload(args: {
  bucket: string;
  path: string;
  file: File | Blob | ArrayBuffer | Uint8Array;
  tenantId: string | null | undefined;
  contentType?: string;
  upsert?: boolean;
  cacheControl?: string;
}) {
  const { bucket, path, file, tenantId, contentType, upsert, cacheControl } = args;

  if (!tenantId) {
    throw new Error(
      'safeStorageUpload: no active tenant — refusing to upload. ' +
        'The user must have an active company before uploading files.'
    );
  }

  const firstSegment = path.split('/')[0];
  if (firstSegment !== tenantId) {
    throw new Error(
      `safeStorageUpload: storage path must start with the active tenant_id ` +
        `("${tenantId}/..."). Got "${firstSegment}/...". Refusing to upload ` +
        `into another tenant's namespace.`
    );
  }

  return supabase.storage.from(bucket).upload(path, file as Blob, {
    contentType,
    upsert,
    cacheControl,
  });
}
