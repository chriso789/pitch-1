// Shared JWT + tenant verification for edge functions.
// Usage:
//   const auth = await verifyAuthAndTenant(req, requestedTenantId);
//   if (auth.error) return auth.error;
//   const supabase = auth.supabase; // service-role client, safe to use after verification
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export type AuthResult =
  | { error: Response }
  | { error: null; userId: string; tenantId: string; isMaster: boolean; supabase: ReturnType<typeof createClient> };

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Validates the caller's JWT and confirms they belong to the requested tenant.
 * Returns a service-role supabase client only after verification succeeds.
 * Master users bypass the tenant-membership check (cross-tenant audit access).
 */
export async function verifyAuthAndTenant(
  req: Request,
  requestedTenantId: string | null | undefined,
): Promise<AuthResult> {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return { error: jsonError("Missing Authorization header", 401) } as AuthResult;
  }

  // Validate JWT against auth.users via the anon client + bearer token.
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) {
    return { error: jsonError("Invalid or expired token", 401) } as AuthResult;
  }
  const userId = userData.user.id;

  // Service client for verified lookups
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // Pull profile to determine tenant + role
  const { data: profile, error: profErr } = await supabase
    .from("profiles")
    .select("tenant_id, active_tenant_id")
    .eq("id", userId)
    .maybeSingle();
  if (profErr || !profile) {
    return { error: jsonError("Profile not found", 403) } as AuthResult;
  }

  // Check master role via user_roles table (proper RBAC)
  const { data: roleRow } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "master")
    .maybeSingle();
  const isMaster = !!roleRow;

  // Collect every tenant the user has access to
  const { data: accessRows } = await supabase
    .from("user_company_access")
    .select("tenant_id")
    .eq("user_id", userId);
  const accessibleTenants = new Set<string>([
    ...(profile.tenant_id ? [profile.tenant_id] : []),
    ...(profile.active_tenant_id ? [profile.active_tenant_id] : []),
    ...((accessRows ?? []).map((r: any) => r.tenant_id).filter(Boolean)),
  ]);

  let tenantId = requestedTenantId ?? profile.active_tenant_id ?? profile.tenant_id ?? null;

  if (requestedTenantId) {
    if (!isMaster && !accessibleTenants.has(requestedTenantId)) {
      return { error: jsonError("Forbidden: not a member of requested tenant", 403) } as AuthResult;
    }
    tenantId = requestedTenantId;
  }

  if (!tenantId) {
    return { error: jsonError("No tenant context available", 400) } as AuthResult;
  }

  return { error: null, userId, tenantId, isMaster, supabase };
}

export { corsHeaders };
