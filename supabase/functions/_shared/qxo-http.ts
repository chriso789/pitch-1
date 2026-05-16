// Shared QXO/Beacon HTTP client.
//
// Goals (audit item #2):
//   - One place that knows the QXO base URL (overridable via QXO_BASE_URL env).
//   - Uniform retry/backoff for transient failures (429 + 5xx + network errors).
//   - Uniform error shape so callers don't each invent their own parser.
//   - Lightweight: no external deps, safe to import from any edge function.
//
// Usage:
//   import { qxoFetch, QxoHttpError } from '../_shared/qxo-http.ts';
//   const data = await qxoFetch('/v1/rest/com/becn/login', {
//     method: 'POST',
//     authHeaders: auth.headers,        // optional
//     body: { username, password, siteId },
//   });

export const DEFAULT_QXO_BASE_URL = 'https://api.qxo.com';

export function getQxoBaseUrl(): string {
  // Allow per-environment override without code changes.
  return (Deno.env.get('QXO_BASE_URL') || DEFAULT_QXO_BASE_URL).replace(/\/+$/, '');
}

export interface QxoFetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Plain JSON-serializable body. Mutually exclusive with `raw`. */
  body?: unknown;
  /** Pre-serialized body (e.g. form data). Sets no Content-Type unless `headers` includes one. */
  raw?: BodyInit;
  /** Extra headers merged on top of defaults. */
  headers?: Record<string, string>;
  /** Bearer/auth headers from getBeaconAuth(). */
  authHeaders?: Record<string, string>;
  /** Query parameters appended to the URL. */
  query?: Record<string, string | number | boolean | undefined | null>;
  /** Override base URL for one-off calls. */
  baseUrl?: string;
  /** Max retry attempts for retryable failures (429 / 5xx / network). Default 3. */
  maxRetries?: number;
  /** Initial backoff in ms; doubles each attempt. Default 400. */
  backoffMs?: number;
  /** Per-attempt timeout in ms. Default 30_000. */
  timeoutMs?: number;
  /** If true, return the raw Response instead of parsed JSON. */
  rawResponse?: boolean;
  /** Override which statuses are retryable (default: 408, 425, 429, 500, 502, 503, 504). */
  retryStatuses?: number[];
}

export class QxoHttpError extends Error {
  status: number;
  body: unknown;
  url: string;
  method: string;
  attempts: number;
  constructor(args: {
    message: string;
    status: number;
    body: unknown;
    url: string;
    method: string;
    attempts: number;
  }) {
    super(args.message);
    this.name = 'QxoHttpError';
    this.status = args.status;
    this.body = args.body;
    this.url = args.url;
    this.method = args.method;
    this.attempts = args.attempts;
  }
}

const DEFAULT_RETRY_STATUSES = [408, 425, 429, 500, 502, 503, 504];

function buildUrl(path: string, baseUrl: string, query?: QxoFetchOptions['query']): string {
  const url = new URL(path.startsWith('http') ? path : baseUrl + (path.startsWith('/') ? path : '/' + path));
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function parseBody(res: Response): Promise<unknown> {
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    return res.json().catch(() => null);
  }
  const text = await res.text().catch(() => '');
  // Try JSON anyway — Beacon occasionally returns JSON without the right header.
  if (text && (text.startsWith('{') || text.startsWith('['))) {
    try { return JSON.parse(text); } catch { /* ignore */ }
  }
  return text;
}

function extractMessage(body: unknown, status: number): string {
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>;
    const msg =
      (typeof b.message === 'string' && b.message) ||
      (typeof b.error === 'string' && b.error) ||
      (typeof b.errorMessage === 'string' && b.errorMessage) ||
      (Array.isArray(b.messages) && b.messages[0] && typeof (b.messages[0] as any).value === 'string'
        ? (b.messages[0] as any).value
        : null);
    if (msg) return msg;
  }
  if (typeof body === 'string' && body) return body.slice(0, 500);
  return `QXO request failed (${status})`;
}

export async function qxoFetch<T = unknown>(
  path: string,
  opts: QxoFetchOptions = {},
): Promise<T> {
  const {
    method = 'GET',
    body,
    raw,
    headers = {},
    authHeaders = {},
    query,
    baseUrl = getQxoBaseUrl(),
    maxRetries = 3,
    backoffMs = 400,
    timeoutMs = 30_000,
    rawResponse = false,
    retryStatuses = DEFAULT_RETRY_STATUSES,
  } = opts;

  const url = buildUrl(path, baseUrl, query);
  const init: RequestInit = { method };

  const mergedHeaders: Record<string, string> = {
    Accept: 'application/json',
    ...authHeaders,
    ...headers,
  };

  if (raw !== undefined) {
    init.body = raw;
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    if (!Object.keys(mergedHeaders).some((h) => h.toLowerCase() === 'content-type')) {
      mergedHeaders['Content-Type'] = 'application/json';
    }
  }
  init.headers = mergedHeaders;

  let lastErr: unknown = null;
  let attempt = 0;

  while (attempt < maxRetries) {
    attempt++;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: ctrl.signal });
      clearTimeout(t);

      if (rawResponse) {
        // Caller wants to read the response themselves; still honor retry on retryable status.
        if (retryStatuses.includes(res.status) && attempt < maxRetries) {
          await sleep(backoffMs * 2 ** (attempt - 1));
          continue;
        }
        return res as unknown as T;
      }

      const parsed = await parseBody(res);

      if (!res.ok) {
        if (retryStatuses.includes(res.status) && attempt < maxRetries) {
          await sleep(backoffMs * 2 ** (attempt - 1));
          continue;
        }
        throw new QxoHttpError({
          message: extractMessage(parsed, res.status),
          status: res.status,
          body: parsed,
          url,
          method,
          attempts: attempt,
        });
      }

      return parsed as T;
    } catch (e) {
      clearTimeout(t);
      lastErr = e;
      // QxoHttpError after the non-retry branch above should bubble up immediately.
      if (e instanceof QxoHttpError) throw e;
      // Network/abort errors: retry until budget is exhausted.
      if (attempt < maxRetries) {
        await sleep(backoffMs * 2 ** (attempt - 1));
        continue;
      }
      break;
    }
  }

  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr || 'QXO request failed');
  throw new QxoHttpError({
    message: msg,
    status: 0,
    body: null,
    url,
    method,
    attempts: attempt,
  });
}
