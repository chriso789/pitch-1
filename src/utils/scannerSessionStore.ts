// IndexedDB-backed autosave for in-progress scan sessions.
// Stores only image blobs + lightweight metadata — never auth tokens or tenant secrets.

import { openDB, IDBPDatabase } from 'idb';

const DB_NAME = 'pitch-scanner-sessions';
const STORE = 'sessions';
const VERSION = 1;

export interface PersistedScanPage {
  blob: Blob;
  cropMode: 'auto' | 'manual';
  colorMode: 'color' | 'bw';
  preset: string;
  pageSize: string;
  deskewAngle: number;
  confidence: number | null;
  outputWidth: number;
  outputHeight: number;
  sourceWidth: number;
  sourceHeight: number;
  rotationApplied: 0 | 90 | 180 | 270;
  captureMethod: string;
  shadowSeverity: string;
  blurOverridden: boolean;
  imageHash?: string;
  pageSizeOverride?: string | null;
  edgeCleanupApplied?: boolean;
  duplicateWarning?: boolean;
  quality?: any;
}

export interface PersistedScanSession {
  id: string;
  scannerSessionId: string;
  pipelineEntryId: string;
  documentType: string;
  documentLabel: string;
  scanPreset: string;
  pdfProfile: string;
  pages: PersistedScanPage[];
  updatedAt: number;
  scannerVersion: string;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
}

function sessionKey(pipelineEntryId: string, documentType: string) {
  return `${pipelineEntryId}::${documentType}`;
}

export async function saveScanSession(s: PersistedScanSession): Promise<void> {
  try {
    const db = await getDb();
    await db.put(STORE, { ...s, updatedAt: Date.now() });
  } catch (e) {
    console.warn('[scanner] saveScanSession failed', e);
  }
}

export async function loadScanSession(
  pipelineEntryId: string,
  documentType: string,
): Promise<PersistedScanSession | null> {
  try {
    const db = await getDb();
    const id = sessionKey(pipelineEntryId, documentType);
    const v = (await db.get(STORE, id)) as PersistedScanSession | undefined;
    if (!v || !v.pages?.length) return null;
    // Stale if older than 7 days.
    if (Date.now() - v.updatedAt > 1000 * 60 * 60 * 24 * 7) {
      await db.delete(STORE, id);
      return null;
    }
    return v;
  } catch (e) {
    console.warn('[scanner] loadScanSession failed', e);
    return null;
  }
}

export async function clearScanSession(
  pipelineEntryId: string,
  documentType: string,
): Promise<void> {
  try {
    const db = await getDb();
    await db.delete(STORE, sessionKey(pipelineEntryId, documentType));
  } catch (e) {
    console.warn('[scanner] clearScanSession failed', e);
  }
}

export function makeSessionId(pipelineEntryId: string, documentType: string): string {
  return sessionKey(pipelineEntryId, documentType);
}

export function makeScannerSessionId(): string {
  return `scn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
