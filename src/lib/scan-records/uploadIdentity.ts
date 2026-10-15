/**
 * Idempotent scan upload identity. One id per (company, record, document type) scan draft,
 * kept on the device until the server confirms the saved row, so retries after a dropped
 * connection reuse the same storage paths and the same documents row instead of duplicating.
 */
const KEY = (tenantId: string, sessionKey: string, docType: string) => `pitch.scanUpload.${tenantId}.${sessionKey}.${docType}`;

export function getOrCreateUploadId(tenantId: string, sessionKey: string, docType: string, store: Storage = localStorage): string {
  const k = KEY(tenantId, sessionKey, docType);
  const existing = store.getItem(k);
  if (existing) return existing;
  const id = crypto.randomUUID();
  store.setItem(k, id);
  return id;
}

export function clearUploadId(tenantId: string, sessionKey: string, docType: string, store: Storage = localStorage) {
  store.removeItem(KEY(tenantId, sessionKey, docType));
}

/** Deterministic paths: the same upload id always writes to the same files (upsert on retry). */
export function scanUploadPaths(tenantId: string, folder: string, uploadId: string, docType: string, pages: number) {
  const base = `${tenantId}/${folder}/${uploadId}_${docType}`;
  return { pdf: `${base}.pdf`, originals: Array.from({ length: pages }, (_, i) => `${base}_originals/page_${i + 1}.jpg`) };
}

export type ScanUploadStatus = 'saved_on_device' | 'uploading' | 'waiting_for_connection' | 'uploaded' | 'processing_ocr' | 'completed' | 'failed';

export const SCAN_UPLOAD_STATUS_LABEL: Record<ScanUploadStatus, string> = {
  saved_on_device: 'Saved on device',
  uploading: 'Uploading',
  waiting_for_connection: 'Waiting for connection',
  uploaded: 'Uploaded',
  processing_ocr: 'Processing OCR',
  completed: 'Completed',
  failed: 'Failed — retry available',
};
