// Per-connection QBO API host resolver.
// Source of truth: qbo_connections.is_sandbox.
// QBO_ENVIRONMENT env var only controls the default for NEW connections during OAuth.

const PROD_HOST = "https://quickbooks.api.intuit.com";
const SANDBOX_HOST = "https://sandbox-quickbooks.api.intuit.com";

export function qboHost(connection: { is_sandbox?: boolean | null } | null | undefined): string {
  return connection?.is_sandbox === true ? SANDBOX_HOST : PROD_HOST;
}

/**
 * Resolve host from realm_id (used by webhook handler where only realm is known).
 * Looks up the active qbo_connections row and returns its host.
 * Returns PROD_HOST as a safe default if no row found.
 */
export async function qboHostFromRealm(
  supabase: { from: (t: string) => any },
  realmId: string,
): Promise<{ host: string; isSandbox: boolean; tenantId: string | null }> {
  const { data } = await supabase
    .from("qbo_connections")
    .select("is_sandbox, tenant_id")
    .eq("realm_id", realmId)
    .eq("is_active", true)
    .maybeSingle();

  const isSandbox = data?.is_sandbox === true;
  return {
    host: isSandbox ? SANDBOX_HOST : PROD_HOST,
    isSandbox,
    tenantId: data?.tenant_id ?? null,
  };
}

export const QBO_PROD_HOST = PROD_HOST;
export const QBO_SANDBOX_HOST = SANDBOX_HOST;
