/**
 * Resolves the correct Supabase Storage bucket for a document based on its type and path.
 * 
 * Company docs are stored in 'smartdoc-assets', while most other documents use 'documents'.
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

  // Default bucket for all other documents
  return 'documents';
}
