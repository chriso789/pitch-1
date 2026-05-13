import { supabase } from '@/integrations/supabase/client';

const BUCKET = 'project-invoices';

/**
 * Extract storage path from either a stored public URL, signed URL, or raw path.
 * Returns null if the value doesn't look like it belongs to the project-invoices bucket.
 */
function extractInvoicePath(value: string): string | null {
  if (!value) return null;

  // Public URL: .../storage/v1/object/public/project-invoices/<path>
  const publicMatch = value.match(/\/storage\/v1\/object\/public\/project-invoices\/(.+?)(?:\?|$)/);
  if (publicMatch) return decodeURIComponent(publicMatch[1]);

  // Signed URL: .../storage/v1/object/sign/project-invoices/<path>?token=...
  const signedMatch = value.match(/\/storage\/v1\/object\/sign\/project-invoices\/(.+?)\?/);
  if (signedMatch) return decodeURIComponent(signedMatch[1]);

  // Raw storage path (no leading slash, not http)
  if (!/^https?:\/\//i.test(value) && !value.startsWith('/')) {
    return value;
  }

  return null;
}

/**
 * Open an invoice document. The `project-invoices` bucket is private, so any
 * stored public URL will 404. This helper detects bucket-owned values and
 * generates a fresh signed URL before opening in a new tab.
 */
export async function openInvoiceDocument(urlOrPath: string | null | undefined): Promise<void> {
  if (!urlOrPath) return;

  const path = extractInvoicePath(urlOrPath);

  if (!path) {
    // Not a project-invoices reference — open as-is.
    window.open(urlOrPath, '_blank', 'noopener,noreferrer');
    return;
  }

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, 60 * 10); // 10 minutes

  if (error || !data?.signedUrl) {
    console.error('Failed to sign invoice URL', error);
    // Fall back so user at least sees the underlying error.
    window.open(urlOrPath, '_blank', 'noopener,noreferrer');
    return;
  }

  window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
}
