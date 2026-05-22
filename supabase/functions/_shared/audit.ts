// Edge-function audit logging. Best-effort, never throws.
// Writes to public.edge_function_audit (created via migration).
//
// Routes get automatic logging from router.ts; use logShimCall() inside shim.ts
// when forwarding legacy calls so we can see which legacy URLs still receive traffic.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

export type AuditRow = {
  function_name: string;
  route: string;
  method: string;
  status: number;
  latency_ms?: number;
  user_id?: string | null;
  tenant_id?: string | null;
  request_id?: string | null;
  shim_from?: string | null;
  notes?: string | null;
};

function client() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function logAuditAsync(row: AuditRow): void {
  try {
    const sb = client();
    if (!sb) return;
    sb.from("edge_function_audit").insert(row).then(() => {}, () => {});
  } catch {/* swallow */}
}

export function logShimCall(fromName: string, targetFn: string, targetRoute: string, status: number): void {
  logAuditAsync({
    function_name: targetFn,
    route: targetRoute,
    method: "SHIM",
    status,
    shim_from: fromName,
    notes: `legacy shim from ${fromName}`,
  });
}
