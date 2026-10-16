/**
 * Retry policy for scan uploads. Errors are classified so the scanner can show the right
 * status and never discard pages: network → wait/retry, expired session → refresh then retry,
 * quota → stop and tell the user, duplicate (same upload id already saved) → treat as success.
 * Uploads use deterministic paths + upsert, so retrying never creates a second file or row.
 */
export type UploadErrorKind = 'network' | 'auth_expired' | 'quota' | 'duplicate' | 'permission' | 'permanent';

export function classifyUploadError(e: any): UploadErrorKind {
  const status = Number(e?.status ?? e?.statusCode ?? 0);
  const code = String(e?.code ?? '');
  const msg = String(e?.message ?? e ?? '').toLowerCase();
  if (code === '23505' || status === 409 || msg.includes('already exists') || msg.includes('duplicate')) return 'duplicate';
  if (e?.name === 'QuotaExceededError' || status === 413 || msg.includes('quota') || msg.includes('exceeded the maximum') || msg.includes('payload too large')) return 'quota';
  if (status === 401 || msg.includes('jwt expired') || msg.includes('invalid jwt') || msg.includes('token is expired')) return 'auth_expired';
  if (status === 403 || code === '42501' || msg.includes('row-level security') || msg.includes('permission denied')) return 'permission';
  if (status === 0 && (e?.name === 'TypeError' || msg.includes('failed to fetch') || msg.includes('network') || msg.includes('load failed') || msg.includes('timeout'))) return 'network';
  if (status >= 500 || status === 408 || status === 429) return 'network';
  return 'permanent';
}

export interface RetryOptions {
  retries?: number;
  baseDelayMs?: number;
  refreshSession?: () => Promise<boolean>;
  sleep?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
}

export class UploadFailure extends Error {
  constructor(public kind: UploadErrorKind, public cause: any) { super(cause?.message ?? String(cause)); }
}

/** Run an upload step; resolves `{ duplicate: true }` when the server already holds it. */
export async function withUploadRetry<T>(step: () => Promise<T>, opts: RetryOptions = {}): Promise<{ value?: T; duplicate: boolean; attempts: number }> {
  const retries = opts.retries ?? 3;
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  let refreshed = false;
  for (let attempt = 1; ; attempt++) {
    if (opts.signal?.aborted) throw new UploadFailure('permanent', new Error('Cancelled'));
    try { return { value: await step(), duplicate: false, attempts: attempt }; }
    catch (e) {
      const kind = classifyUploadError(e);
      if (kind === 'duplicate') return { duplicate: true, attempts: attempt };
      if (kind === 'auth_expired' && !refreshed && opts.refreshSession) {
        refreshed = true;
        if (await opts.refreshSession()) { attempt--; continue; }
        throw new UploadFailure('auth_expired', e);
      }
      if (kind === 'network' && attempt <= retries) { await sleep((opts.baseDelayMs ?? 500) * 2 ** (attempt - 1)); continue; }
      throw new UploadFailure(kind, e);
    }
  }
}

/** Supabase storage/postgrest return `{ error }` instead of throwing; convert to a throw. */
export async function throwing<T extends { error: any }>(p: PromiseLike<T>): Promise<T> {
  const r = await p; if (r.error) throw r.error; return r;
}

export const UPLOAD_FAILURE_MESSAGE: Record<UploadErrorKind, string> = {
  network: 'Connection lost. Your pages are saved on this device and will upload when you are back online.',
  auth_expired: 'Your sign-in expired. Sign in again; your pages are kept on this device.',
  quota: 'Not enough storage space. Free up space or remove pages; nothing was deleted.',
  duplicate: 'Already saved.',
  permission: 'This company does not allow you to save here. Your pages are kept on this device.',
  permanent: 'Upload failed. Your pages are kept on this device — try again.',
};
