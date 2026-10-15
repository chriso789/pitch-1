import { loadInvoiceBlobUrl } from './loadInvoiceBlob';

/**
 * Open an invoice document in a new tab via a local blob: URL so storage
 * hostnames are never navigated to directly.
 */
export async function openInvoiceDocument(urlOrPath: string | null | undefined): Promise<void> {
  if (!urlOrPath) return;
  const win = window.open('', '_blank');
  try {
    const { url } = await loadInvoiceBlobUrl(urlOrPath);
    if (win) win.location.href = url;
    else window.open(url, '_blank');
  } catch (e) {
    console.error('Failed to open invoice', e);
    win?.close();
    throw e;
  }
}
