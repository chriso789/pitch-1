// IndexedDB-backed autosave for in-progress scan sessions.
// Stores only image blobs + lightweight metadata — never auth tokens or tenant secrets.
//
// Hardening (production phase):
//  - Default TTL reduced to 24 hours; expired sessions purged on open.
//  - Global quota (75MB) enforced; save() returns a status so callers can
//    decide whether to disable autosave or warn the user.
//  - listScanSessions() + clearAllScanSessions() power the diagnostics UI.

import { openDB, IDBPDatabase } from 'idb';

const DB_NAME = 'pitch-scanner-sessions';
const STORE = 'sessions';
const VERSION = 1;

export const DEFAULT_SESSION_TTL_MS = 1000 * 60 * 60 * 24; // 24h
export const DEFAULT_MAX_TOTAL_BYTES = 75 * 1024 * 1024; // 75MB

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

export interface SaveResult {
  ok: boolean;
  reason?: 'quota_exceeded' | 'error';
  bytesAfter: number;
  quotaBytes: number;
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

function sessionBytes(s: PersistedScanSession): number {
  let n = 0;
  for (const p of s.pages) n += p.blob?.size ?? 0;
  return n;
}

async function totalBytes(db: IDBPDatabase, excludeId?: string): Promise<number> {
  const all = (await db.getAll(STORE)) as PersistedScanSession[];
  let n = 0;
  for (const s of all) {
    if (s.id === excludeId) continue;
    n += sessionBytes(s);
  }
  return n;
}

/**
 * Delete sessions older than the TTL. Safe to call on every scanner open.
 * Returns the number purged.
 */
export async function purgeExpiredScanSessions(
  ttlMs: number = DEFAULT_SESSION_TTL_MS,
): Promise<number> {
  try {
    const db = await getDb();
    const all = (await db.getAll(STORE)) as PersistedScanSession[];
    const cutoff = Date.now() - ttlMs;
    let purged = 0;
    for (const s of all) {
      if (!s.updatedAt || s.updatedAt < cutoff) {
        await db.delete(STORE, s.id);
        purged++;
      }
    }
    return purged;
  } catch (e) {
    console.warn('[scanner] purgeExpiredScanSessions failed', e);
    return 0;
  }
}

export async function saveScanSession(
  s: PersistedScanSession,
  opts: { maxTotalBytes?: number } = {},
): Promise<SaveResult> {
  const quota = opts.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
  try {
    const db = await getDb();
    const incoming = sessionBytes(s);
    const otherBytes = await totalBytes(db, s.id);
    const projected = otherBytes + incoming;
    if (projected > quota) {
      return { ok: false, reason: 'quota_exceeded', bytesAfter: projected, quotaBytes: quota };
    }
    await db.put(STORE, { ...s, updatedAt: Date.now() });
    return { ok: true, bytesAfter: projected, quotaBytes: quota };
  } catch (e) {
    console.warn('[scanner] saveScanSession failed', e);
    return { ok: false, reason: 'error', bytesAfter: 0, quotaBytes: quota };
  }
}

export async function loadScanSession(
  pipelineEntryId: string,
  documentType: string,
  ttlMs: number = DEFAULT_SESSION_TTL_MS,
): Promise<PersistedScanSession | null> {
  try {
    const db = await getDb();
    const id = sessionKey(pipelineEntryId, documentType);
    const v = (await db.get(STORE, id)) as PersistedScanSession | undefined;
    if (!v || !v.pages?.length) return null;
    if (Date.now() - v.updatedAt > ttlMs) {
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

export interface ScanSessionSummary {
  id: string;
  documentLabel: string;
  documentType: string;
  pages: number;
  bytes: number;
  updatedAt: number;
}

export async function listScanSessions(): Promise<ScanSessionSummary[]> {
  try {
    const db = await getDb();
    const all = (await db.getAll(STORE)) as PersistedScanSession[];
    return all.map((s) => ({
      id: s.id,
      documentLabel: s.documentLabel,
      documentType: s.documentType,
      pages: s.pages?.length ?? 0,
      bytes: sessionBytes(s),
      updatedAt: s.updatedAt,
    }));
  } catch {
    return [];
  }
}

export async function clearAllScanSessions(): Promise<number> {
  try {
    const db = await getDb();
    const all = (await db.getAll(STORE)) as PersistedScanSession[];
    for (const s of all) await db.delete(STORE, s.id);
    return all.length;
  } catch {
    return 0;
  }
}

export async function getScanStorageUsage(): Promise<{ bytes: number; quota: number }> {
  try {
    const db = await getDb();
    return { bytes: await totalBytes(db), quota: DEFAULT_MAX_TOTAL_BYTES };
  } catch {
    return { bytes: 0, quota: DEFAULT_MAX_TOTAL_BYTES };
  }
}

export function makeSessionId(pipelineEntryId: string, documentType: string): string {
  return sessionKey(pipelineEntryId, documentType);
}

export function makeScannerSessionId(): string {
  return `scn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
