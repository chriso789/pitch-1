// Thin wrapper that delegates to qbo-context.ts (the canonical environment resolver).
// Kept for backwards compatibility — existing call sites pass a connection row and
// get the right host whether the row carries oauth_app_env or just legacy is_sandbox.

import {
  getQboContextForConnection,
  QBO_PROD_HOST,
  QBO_SANDBOX_HOST,
} from "./qbo-context.ts";

export function qboHost(
  connection: { is_sandbox?: boolean | null; oauth_app_env?: string | null } | null | undefined,
): string {
  try {
    return getQboContextForConnection(connection).accountingBaseUrl;
  } catch {
    // No creds configured — fall back to pure host selection so callers that only
    // need the URL (not credentials) still work.
    return connection?.is_sandbox === true || connection?.oauth_app_env === "development"
      ? QBO_SANDBOX_HOST
      : QBO_PROD_HOST;
  }
}

/**
 * Resolve host from realm_id (used by webhook handler where only realm is known).
 */
export async function qboHostFromRealm(
  supabase: { from: (t: string) => any },
  realmId: string,
): Promise<{ host: string; isSandbox: boolean; tenantId: string | null }> {
  const { data } = await supabase
    .from("qbo_connections")
    .select("is_sandbox, oauth_app_env, tenant_id")
    .eq("realm_id", realmId)
    .eq("is_active", true)
    .maybeSingle();

  const host = qboHost(data ?? undefined);
  return {
    host,
    isSandbox: host === QBO_SANDBOX_HOST,
    tenantId: data?.tenant_id ?? null,
  };
}

export { QBO_PROD_HOST, QBO_SANDBOX_HOST };
