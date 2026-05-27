// canvass-api /auth — JWT-trusted identity bootstrap for the canvass mobile client.
// Identity comes from middleware-resolved (userId, tenantId). Body is ignored.

import type { Context } from "jsr:@hono/hono";
import { jsonOk, jsonErr, serviceClient, type RouterEnv } from "../_shared/router.ts";

export async function handleAuth(c: Context<RouterEnv>) {
  const userId = c.get("userId")!;
  const tenantId = c.get("tenantId")!;
  const svc = serviceClient();

  // Profile (server-trusted role + name + email)
  const { data: profile, error: profileErr } = await svc
    .from("profiles")
    .select("id, first_name, last_name, email, role, tenant_id, is_active")
    .eq("id", userId)
    .maybeSingle();

  if (profileErr) return jsonErr(c, "profile_lookup_failed", profileErr.message, 500);
  if (!profile) return jsonErr(c, "profile_not_found", "Profile missing for authenticated user", 404);
  if (profile.is_active === false) return jsonErr(c, "inactive_user", "User is disabled", 403);

  // Tenant-scoped dispositions
  const { data: dispositions } = await svc
    .from("dialer_dispositions")
    .select("id, name, description, is_positive")
    .eq("tenant_id", tenantId)
    .eq("is_active", true);

  // Tenant-scoped territories via user_location_assignments
  const { data: assignments } = await svc
    .from("user_location_assignments")
    .select("location_id, is_active, locations:locations(id, name, address, territory_bounds, tenant_id)")
    .eq("user_id", userId)
    .eq("is_active", true);

  const territories = (assignments ?? [])
    .map((a: any) => a.locations)
    .filter((l: any) => l && l.tenant_id === tenantId);

  return jsonOk(c, {
    rep: {
      id: profile.id,
      name: `${profile.first_name ?? ""} ${profile.last_name ?? ""}`.trim(),
      email: profile.email,
      role: profile.role,
      tenant_id: tenantId,
      is_active: profile.is_active !== false,
      territories,
    },
    dispositions: dispositions ?? [],
    server_time: new Date().toISOString(),
  });
}
