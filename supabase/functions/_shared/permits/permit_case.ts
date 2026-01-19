// =========================================================
// Permit Case CRUD Operations
// =========================================================

import { PermitCaseRow } from "./types.ts";

type UpsertArgs = {
  tenant_id: string;
  job_id: string;
  estimate_id: string | null;
  force_rebuild: boolean;
  created_by: string;
};

export async function upsertPermitCase(supabase: any, args: UpsertArgs): Promise<PermitCaseRow> {
  // Reuse existing case unless force_rebuild
  const { data: existing, error: qerr } = await supabase
    .from("permit_cases")
    .select("*")
    .eq("tenant_id", args.tenant_id)
    .eq("job_id", args.job_id)
    .eq("estimate_id", args.estimate_id)
    .neq("status", "VOID")
    .order("created_at", { ascending: false })
    .limit(1);

  if (qerr) throw qerr;

  if (existing?.length && !args.force_rebuild) return existing[0];

  const insert = {
    tenant_id: args.tenant_id,
    job_id: args.job_id,
    estimate_id: args.estimate_id,
    status: "NOT_STARTED",
    created_by: args.created_by,
  };

  const { data, error } = await supabase.from("permit_cases").insert(insert).select("*").single();
  if (error) throw error;
  return data;
}

export async function writePermitEvent(
  supabase: any,
  tenantId: string,
  permitCaseId: string,
  eventType: string,
  message: string,
  details: Record<string, unknown> = {},
) {
  const { error } = await supabase.from("permit_case_events").insert({
    tenant_id: tenantId,
    permit_case_id: permitCaseId,
    event_type: eventType,
    message,
    details,
  });
  if (error) throw error;
}
