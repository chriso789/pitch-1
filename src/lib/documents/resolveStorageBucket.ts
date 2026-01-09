/**
 * Resolves the correct Supabase Storage bucket for a document based on its type and path.
 * 
 * Company docs are stored in 'smartdoc-assets', while most other documents use 'documents'.
 * Photos are stored in 'customer-photos'.
 */
export function resolveStorageBucket(
  documentType?: string | null,
  filePath?: string | null
): string {
  // Company resource docs are stored in smartdoc-assets
  if (documentType === 'company_resource') {
    return 'smartdoc-assets';
  }

  // Files in company-docs folder are in smartdoc-assets
  if (filePath?.startsWith('company-docs/')) {
    return 'smartdoc-assets';
  }

  // Photo documents use customer-photos bucket
  if (documentType === 'photo' || documentType === 'inspection_photo' || documentType === 'required_photos') {
    return 'customer-photos';
  }

  // Files in leads folder (photos) are in customer-photos
  if (filePath?.includes('/leads/')) {
    return 'customer-photos';
  }

  // Default bucket for all other documents
  return 'documents';
}
