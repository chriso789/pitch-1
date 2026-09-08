/**
 * Remembers the page a user was on when an auth check bounced them to /login,
 * so a browser refresh deep inside the app returns them to that same page
 * instead of the dashboard.
 */

const RETURN_TO_KEY = 'pitch_return_to';

const isSafeInternalPath = (path: unknown): path is string =>
  typeof path === 'string' &&
  path.startsWith('/') &&
  !path.startsWith('//') &&
  !['/login', '/signup', '/', '/logout'].includes(path.split('?')[0]);

export function saveReturnTo(path: string): void {
  if (typeof window === 'undefined') return;
  if (!isSafeInternalPath(path)) return;
  try {
    sessionStorage.setItem(RETURN_TO_KEY, path);
  } catch {
    /* ignore */
  }
}

/** Reads and clears the stored path. */
export function consumeReturnTo(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const v = sessionStorage.getItem(RETURN_TO_KEY);
    sessionStorage.removeItem(RETURN_TO_KEY);
    return isSafeInternalPath(v) ? v : null;
  } catch {
    return null;
  }
}

export function clearReturnTo(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(RETURN_TO_KEY);
  } catch {
    /* ignore */
  }
}
