// QXO tenant guard.
// Loads the QXO connection for the JWT-resolved tenant and verifies:
//   1. connection exists for this tenant
//   2. authorization_status is 'active'
//   3. connection_status is 'connected'
//   4. required scope is present (when supplied)
//
// NEVER trusts body.tenant_id / body.company_id / body.account_id / body.credential_id.
// NEVER returns credentials to the response — only the connection row (without secrets).

import type { Context } from "jsr:@hono/hono";
import { jsonErr, serviceClient, type RouterEnv } from "../router.ts";

export type QxoScope =
  | "pricing"
  | "catalog"
  | "order_submit"
  | "order_status"
  | "invoice_read"
  | "delivery_tracking";

export interface QxoGuardResult {
  userId: string;
  tenantId: string;
  requestId: string;
  qxoConnection: Record<string, unknown>;
}

export interface QxoGuardOptions {
  action: string;
  requiredScope?: QxoScope;
}

/**
 * Returns either a guard result or a `Response` envelope to return immediately.
 * Edge function callers MUST check with `instanceof Response` and return early.
 */
export async function qxoTenantGuard(
  c: Context<RouterEnv>,
  opts: QxoGuardOptions,
): Promise<QxoGuardResult | Response> {
  const userId = c.get("userId");
  const tenantId = c.get("tenantId");
  const requestId = c.get("requestId");

  if (!userId || !tenantId) {
    return jsonErr(c, "unauthorized", "Auth and tenant required", 401);
  }

  const svc = serviceClient();
  const { data: conn, error } = await svc
    .from("qxo_connections")
    .select(
      "id,tenant_id,site_id,account_id,account_number,profile_id,default_branch_code,environment,connection_status,authorization_status,authorization_method,scopes,revoked_at,last_verified_at,has_credentials",
    )
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) {
    console.error("[qxo-guard] connection lookup failed", { tenantId, error: error.message });
    return jsonErr(c, "qxo_lookup_failed", "Could not load QXO connection", 500);
  }

  if (!conn) {
    return jsonErr(
      c,
      "qxo_connection_missing",
      "No QXO connection is configured for this company. Connect QXO in Settings → Integrations.",
      412,
    );
  }

  // Belt-and-suspenders: even though we queried by tenant_id, verify it matches.
  if (String(conn.tenant_id) !== String(tenantId)) {
    console.error("[qxo-guard] tenant_id mismatch", { expected: tenantId, got: conn.tenant_id });
    return jsonErr(c, "qxo_not_authorized", "QXO connection does not belong to this tenant.", 403);
  }

  if (conn.revoked_at) {
    return jsonErr(c, "qxo_connection_revoked", "QXO connection has been revoked.", 403);
  }

  if (conn.connection_status && conn.connection_status !== "connected") {
    return jsonErr(
      c,
      "qxo_connection_not_ready",
      `QXO connection is ${conn.connection_status}. Reconnect in Settings → Integrations.`,
      412,
    );
  }

  if (conn.authorization_status && conn.authorization_status !== "active") {
    return jsonErr(
      c,
      "qxo_not_authorized",
      `QXO authorization is ${conn.authorization_status}. Reconnect in Settings → Integrations.`,
      403,
    );
  }

  if (opts.requiredScope) {
    const scopes = Array.isArray(conn.scopes) ? (conn.scopes as string[]) : [];
    if (!scopes.includes(opts.requiredScope)) {
      return jsonErr(
        c,
        "qxo_scope_missing",
        `QXO authorization does not grant the '${opts.requiredScope}' scope required for this action.`,
        403,
      );
    }
  }

  return {
    userId,
    tenantId,
    requestId,
    qxoConnection: conn as Record<string, unknown>,
  };
}
