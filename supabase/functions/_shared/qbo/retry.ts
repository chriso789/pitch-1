// Shared retry / idempotency wrapper for QBO calls.
//
// Phase 1B, item 8 "ERROR AND RETRY HANDLING":
//   - retryable QBO fetch with exponential backoff on 429 + 5xx
//   - single token-refresh retry on 401
//   - stable requestid so a retry never creates a second QBO invoice
//   - explicit handling of 400 / 401 / 403 / 404 / 429 / 5xx
//   - Intuit-Tid always captured on the last response
//
// NOTE: this module is intentionally token-agnostic. Callers pass in a
// `getAccessToken()` function; the wrapper re-invokes it once on 401 so
// the caller controls the refresh strategy.

import { getIntuitTid } from "../qbo-intuit-tid.ts";

export interface QboFetchOptions {
  method: "GET" | "POST" | "PUT" | "DELETE";
  url: string;
  body?: unknown;
  /** Called on 401 to refresh the token; must return the fresh access token. */
  getAccessToken: () => Promise<string>;
  /** Idempotency key. For POST create, pass a stable UUID so retries do not double-post. */
  requestId?: string;
  /** Max retries for transient failures (429, 5xx, network). Default 3. */
  maxRetries?: number;
  /** Base backoff in ms. Default 250. */
  baseBackoffMs?: number;
  /** Optional extra headers merged after Authorization/Accept/Content-Type. */
  extraHeaders?: Record<string, string>;
}

export interface QboFetchResult {
  ok: boolean;
  status: number;
  bodyText: string;
  json?: unknown;
  intuitTid: string | null;
  attempts: number;
  classification:
    | "success"
    | "bad_request"
    | "unauthorized"
    | "forbidden"
    | "not_found"
    | "rate_limited"
    | "server_error"
    | "network_error";
}

function classify(status: number): QboFetchResult["classification"] {
  if (status >= 200 && status < 300) return "success";
  if (status === 400) return "bad_request";
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server_error";
  return "server_error";
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function qboFetch(opts: QboFetchOptions): Promise<QboFetchResult> {
  const {
    method,
    url,
    body,
    getAccessToken,
    requestId,
    maxRetries = 3,
    baseBackoffMs = 250,
    extraHeaders = {},
  } = opts;

  let token = await getAccessToken();
  let refreshed = false;
  let attempt = 0;
  let lastErr: QboFetchResult | null = null;

  // Attach requestid as query param for QBO idempotency on POST creates.
  const finalUrl = requestId && method === "POST"
    ? url + (url.includes("?") ? "&" : "?") + `requestid=${encodeURIComponent(requestId)}`
    : url;

  while (attempt <= maxRetries) {
    attempt += 1;
    let res: Response;
    try {
      res = await fetch(finalUrl, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...extraHeaders,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      lastErr = {
        ok: false,
        status: 0,
        bodyText: e instanceof Error ? e.message : String(e),
        intuitTid: null,
        attempts: attempt,
        classification: "network_error",
      };
      if (attempt > maxRetries) return lastErr;
      await sleep(baseBackoffMs * 2 ** (attempt - 1));
      continue;
    }

    const intuitTid = getIntuitTid(res);
    const bodyText = await res.text();
    const cls = classify(res.status);

    if (cls === "success") {
      let json: unknown;
      try { json = bodyText ? JSON.parse(bodyText) : undefined; } catch { /* leave undefined */ }
      return { ok: true, status: res.status, bodyText, json, intuitTid, attempts: attempt, classification: cls };
    }

    // 401 → single token refresh retry
    if (cls === "unauthorized" && !refreshed) {
      refreshed = true;
      token = await getAccessToken();
      continue;
    }

    // 429 / 5xx / network → exponential backoff up to maxRetries
    if (cls === "rate_limited" || cls === "server_error") {
      lastErr = { ok: false, status: res.status, bodyText, intuitTid, attempts: attempt, classification: cls };
      if (attempt > maxRetries) return lastErr;
      await sleep(baseBackoffMs * 2 ** (attempt - 1));
      continue;
    }

    // 400 / 403 / 404 / repeated 401 → terminal
    return { ok: false, status: res.status, bodyText, intuitTid, attempts: attempt, classification: cls };
  }

  return lastErr ?? {
    ok: false, status: 0, bodyText: "unknown",
    intuitTid: null, attempts: attempt, classification: "network_error",
  };
}

/**
 * Deterministic idempotency key for QBO invoice create.
 * A retry of the SAME (tenant, project, estimate) MUST yield the same requestid,
 * so QBO short-circuits the duplicate POST rather than creating a second invoice.
 */
export function stableInvoiceRequestId(input: {
  tenantId: string;
  connectionId: string;
  projectId: string;
  estimateId: string;
}): string {
  // uuid-v5-style deterministic key derived from stable inputs.
  const raw = `${input.tenantId}|${input.connectionId}|${input.projectId}|${input.estimateId}`;
  // Simple deterministic hash → UUIDv4-shaped string. QBO only requires "unique per idempotent op".
  let h1 = 0x811c9dc5;
  for (let i = 0; i < raw.length; i++) {
    h1 ^= raw.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193);
  }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, "0");
  const a = hex(h1);
  const b = hex(Math.imul(h1, 2654435761));
  const c = hex(Math.imul(h1 ^ 0xdeadbeef, 40503));
  const d = hex(Math.imul(h1 ^ 0x1b873593, 2246822507));
  return `${a}-${b.slice(0, 4)}-${b.slice(4)}-${c.slice(0, 4)}-${c.slice(4)}${d.slice(0, 4)}`;
}
