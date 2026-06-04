// Shared QBO API wrapper used by every edge function that talks to Intuit.
//
// Responsibilities:
//   1. Refresh access token server-side before the call if it is expired or near expiry.
//   2. Make the HTTPS request to the correct host (sandbox vs production) based on the
//      stored connection's `oauth_app_env` / `is_sandbox`.
//   3. Capture Intuit's `intuit_tid` response-header trace id.
//   4. Persist a row to public.qbo_api_logs (success or failure) with structured metadata.
//   5. Translate `invalid_grant` failures into a reauth state on qbo_connections.
//
// HARD RULES — never broken:
//   * Access tokens and refresh tokens are NEVER written to qbo_api_logs (nor any log line).
//   * Logging failures must never abort the underlying API call result.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.49.1";
import { qboHost } from "./qbo-host.ts";
import { getIntuitTid } from "./qbo-intuit-tid.ts";
import {
  createServiceClient,
  refreshAccessToken,
  persistTokens,
  QboReauthRequiredError,
  type QboConnectionRow,
} from "./qbo-auth.ts";
import { getQboContextForConnection } from "./qbo-context.ts";

const REFRESH_SKEW_MS = 5 * 60 * 1000; // refresh if <5min remaining on access token

export interface QboLogContext {
  /** Logical action name, e.g. `qbo_customer_sync`, `qbo_invoice_create`. */
  action: string;
  /** Optional sub-operation, e.g. `fetch_invoice`, `create`. */
  op?: string;
  tenant_id?: string | null;
  user_id?: string | null;
  connection_id?: string | null;
  qbo_entity?: string | null;
  qbo_entity_id?: string | null;
  /** Extra fields stored under request_metadata. Never include tokens. */
  request_metadata?: Record<string, unknown>;
}

export interface QboFetchOptions extends RequestInit {
  /** Skip token-refresh path. Used for the refresh call itself. */
  skipRefresh?: boolean;
}

export interface QboFetchResult {
  response: Response;
  intuit_tid: string | null;
  duration_ms: number;
}

/**
 * Best-effort log write to qbo_api_logs. Never throws — logging must not block the
 * caller, and is intentionally separate from the audit_log table.
 */
export async function writeQboApiLog(
  service: SupabaseClient,
  fields: {
    action: string;
    tenant_id?: string | null;
    user_id?: string | null;
    connection_id?: string | null;
    realm_id?: string | null;
    oauth_app_env?: string | null;
    endpoint?: string | null;
    method?: string | null;
    http_status?: number | null;
    intuit_tid?: string | null;
    success: boolean;
    error_code?: string | null;
    error_message?: string | null;
    duration_ms?: number | null;
    request_metadata?: Record<string, unknown>;
    response_metadata?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    // Sanitize: hard-strip token-shaped keys if a caller ever passed them by mistake.
    const safeReq = stripTokenKeys(fields.request_metadata ?? {});
    const safeRes = stripTokenKeys(fields.response_metadata ?? {});

    await service.from("qbo_api_logs").insert({
      tenant_id: fields.tenant_id ?? null,
      user_id: fields.user_id ?? null,
      connection_id: fields.connection_id ?? null,
      realm_id: fields.realm_id ?? null,
      oauth_app_env: fields.oauth_app_env ?? null,
      action: fields.action,
      endpoint: fields.endpoint ?? null,
      method: fields.method ?? null,
      http_status: fields.http_status ?? null,
      intuit_tid: fields.intuit_tid ?? null,
      success: !!fields.success,
      error_code: fields.error_code ?? null,
      error_message: fields.error_message ? truncate(fields.error_message, 1000) : null,
      duration_ms: fields.duration_ms ?? null,
      request_metadata: safeReq,
      response_metadata: safeRes,
    });
  } catch (e) {
    console.warn("[qbo-api] writeQboApiLog failed (continuing):", e instanceof Error ? e.message : String(e));
  }
}

function stripTokenKeys(obj: Record<string, unknown>): Record<string, unknown> {
  if (!obj || typeof obj !== "object") return {};
  const TOKEN_RE = /(access_token|refresh_token|authorization|bearer|client_secret|verifier)/i;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (TOKEN_RE.test(k)) continue;
    out[k] = v;
  }
  return out;
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n) + `… [+${s.length - n} chars]`;
}

/**
 * Refresh the access token in-place if it is expired or within REFRESH_SKEW_MS of expiry.
 * Returns the (possibly updated) connection row. Throws QboReauthRequiredError on
 * invalid_grant and marks the connection inactive + reauth_required in metadata.
 */
export async function refreshQboTokenIfNeeded(
  service: SupabaseClient,
  connection: QboConnectionRow,
): Promise<QboConnectionRow> {
  const expMs = connection.token_expires_at ? Date.parse(connection.token_expires_at) : 0;
  const needs = !expMs || expMs - Date.now() < REFRESH_SKEW_MS;
  if (!needs) return connection;

  try {
    const refreshed = await refreshAccessToken(connection.refresh_token, getQboContextForConnection(connection));
    const updated = await persistTokens(service, {
      tenant_id: connection.tenant_id,
      realm_id: connection.realm_id,
      tokens: refreshed,
    });
    return updated;
  } catch (e) {
    if (e instanceof QboReauthRequiredError) {
      await markQboReauthRequired(service, connection.id, "invalid_grant");
    }
    throw e;
  }
}

/**
 * Mark a connection as needing reauthorization. Used when Intuit returns invalid_grant
 * during a refresh, or 401 persists after a successful refresh.
 */
export async function markQboReauthRequired(
  service: SupabaseClient,
  connectionId: string,
  reason: string,
): Promise<void> {
  try {
    // Read existing metadata so we can merge.
    const { data } = await service
      .from("qbo_connections")
      .select("metadata")
      .eq("id", connectionId)
      .maybeSingle();
    const meta = (data?.metadata as Record<string, unknown> | null) ?? {};
    await service
      .from("qbo_connections")
      .update({
        is_active: false,
        disconnected_at: new Date().toISOString(),
        metadata: {
          ...meta,
          reauth_required: true,
          reauth_reason: reason,
          reauth_marked_at: new Date().toISOString(),
        },
      })
      .eq("id", connectionId);
  } catch (e) {
    console.warn("[qbo-api] markQboReauthRequired failed:", e instanceof Error ? e.message : String(e));
  }
}

/**
 * Resolve a fetch URL: if it starts with "http", use as-is; otherwise prefix with
 * the connection's QBO host. Path should start with "/" (e.g. "/v3/company/...").
 */
function resolveUrl(connection: QboConnectionRow, pathOrUrl: string): string {
  if (/^https?:\/\//.test(pathOrUrl)) return pathOrUrl;
  return `${qboHost(connection)}${pathOrUrl}`;
}

function deriveEndpoint(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname;
  } catch {
    return url;
  }
}

/**
 * Core QBO fetch wrapper. Refreshes token if near expiry, sets standard headers, and
 * captures `intuit_tid` + writes qbo_api_logs row.
 *
 * Returns the raw Response (caller decides .json() / .text()) plus the captured tid.
 * On 401 with refresh already attempted, marks reauth_required and surfaces the response.
 */
export async function qboFetch(
  service: SupabaseClient,
  connection: QboConnectionRow,
  pathOrUrl: string,
  options: QboFetchOptions = {},
  logCtx: QboLogContext = { action: "qbo_api_call" },
): Promise<QboFetchResult & { connection: QboConnectionRow }> {
  let conn = connection;
  if (!options.skipRefresh) {
    conn = await refreshQboTokenIfNeeded(service, conn);
  }

  const url = resolveUrl(conn, pathOrUrl);
  const endpoint = deriveEndpoint(url);
  const method = (options.method ?? "GET").toUpperCase();

  // Build headers: always inject Authorization + Accept; do not overwrite caller's
  // Content-Type if provided.
  const headers = new Headers(options.headers ?? {});
  headers.set("Authorization", `Bearer ${conn.access_token}`);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");

  const started = Date.now();
  let response: Response;
  let intuit_tid: string | null = null;
  let success = false;
  let errorMessage: string | null = null;
  let httpStatus: number | null = null;

  try {
    response = await fetch(url, { ...options, headers });
    intuit_tid = getIntuitTid(response);
    httpStatus = response.status;
    success = response.ok;
    if (!success) {
      // Peek body for error message, but do not consume — clone for the caller.
      try {
        const peek = await response.clone().text();
        errorMessage = truncate(peek, 500);
      } catch {
        errorMessage = response.statusText;
      }
    }
  } catch (e) {
    errorMessage = e instanceof Error ? e.message : String(e);
    throw e;
  } finally {
    const duration_ms = Date.now() - started;
    // Fire-and-forget logging.
    void writeQboApiLog(service, {
      action: logCtx.action,
      tenant_id: logCtx.tenant_id ?? conn.tenant_id ?? null,
      user_id: logCtx.user_id ?? null,
      connection_id: logCtx.connection_id ?? conn.id ?? null,
      realm_id: conn.realm_id ?? null,
      oauth_app_env: conn.oauth_app_env ?? (conn.is_sandbox ? "development" : "production"),
      endpoint,
      method,
      http_status: httpStatus,
      intuit_tid,
      success,
      error_message: errorMessage,
      duration_ms,
      request_metadata: {
        ...(logCtx.op ? { op: logCtx.op } : {}),
        ...(logCtx.qbo_entity ? { qbo_entity: logCtx.qbo_entity } : {}),
        ...(logCtx.qbo_entity_id ? { qbo_entity_id: logCtx.qbo_entity_id } : {}),
        ...(logCtx.request_metadata ?? {}),
      },
    });
  }

  // If we got a 401 even after refresh, flip the connection into reauth_required.
  if (response!.status === 401 && !options.skipRefresh) {
    await markQboReauthRequired(service, conn.id, "401_after_refresh");
  }

  return { response: response!, intuit_tid, duration_ms: Date.now() - started, connection: conn };
}

/**
 * Convenience wrapper: returns parsed JSON or throws an Error whose message embeds the
 * intuit_tid + http status. Caller still gets structured error_message in qbo_api_logs.
 */
export async function qboJson<T = unknown>(
  service: SupabaseClient,
  connection: QboConnectionRow,
  pathOrUrl: string,
  options: QboFetchOptions = {},
  logCtx: QboLogContext = { action: "qbo_api_call" },
): Promise<{ data: T; intuit_tid: string | null; connection: QboConnectionRow }> {
  const { response, intuit_tid, connection: conn } = await qboFetch(
    service,
    connection,
    pathOrUrl,
    options,
    logCtx,
  );
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `${logCtx.action}${logCtx.op ? `:${logCtx.op}` : ""} failed [status=${response.status} intuit_tid=${intuit_tid ?? "none"}]: ${truncate(body, 300)}`,
    );
  }
  const data = (await response.json()) as T;
  return { data, intuit_tid, connection: conn };
}

/** Re-export for ergonomic imports from feature functions. */
export { createServiceClient, getIntuitTid };
