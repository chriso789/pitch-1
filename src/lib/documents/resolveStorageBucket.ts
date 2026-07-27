/**
 * Resolves the correct Supabase Storage bucket for a document based on its type and path.
 *
 * Company docs are stored in 'smartdoc-assets', project invoices/receipts live in
 * 'project-invoices', photos in 'customer-photos', and most other documents in 'documents'.
 */
export function resolveStorageBucket(
  documentType?: string | null,
  filePath?: string | null
): string {
  // If the stored value is a Supabase storage URL, trust the bucket embedded in it
  const fromUrl = extractStorageRef(filePath);
  if (fromUrl) return fromUrl.bucket;

  // Company resource docs are stored in smartdoc-assets
  if (documentType === 'company_resource') {
    return 'smartdoc-assets';
  }

  // Files in company-docs folder are in smartdoc-assets
  if (filePath?.startsWith('company-docs/')) {
    return 'smartdoc-assets';
  }

  // Project invoices / receipts (material, labor, overhead) live in their own bucket
  if (documentType?.startsWith('invoice_') || documentType === 'supplier_quote') {
    return 'project-invoices';
  }

  // Photo documents use customer-photos bucket
  if (documentType === 'photo' || documentType === 'inspection_photo' || documentType === 'required_photos') {
    if (filePath?.includes('/leads/')) {
      return 'customer-photos';
    }
    return 'documents';
  }

  // Files in leads folder (photos) are in customer-photos
  if (filePath?.includes('/leads/')) {
    return 'customer-photos';
  }

  // Default bucket for all other documents
  return 'documents';
}

/**
 * Parses a Supabase Storage public/signed/authenticated URL into { bucket, path }.
 * Returns null when the value is not a Supabase storage URL.
 */
export function extractStorageRef(
  value?: string | null
): { bucket: string; path: string } | null {
  if (!value || !/^https?:\/\//i.test(value)) return null;
  const match = value.match(
    /\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/?]+)\/(.+?)(?:\?|$)/
  );
  if (!match) return null;
  return { bucket: match[1], path: decodeURIComponent(match[2]) };
}
