// Best-effort resolver of the owning company/tenant for usage attribution.
// Resolution order:
//   1. explicit company_id / tenant_id
//   2. job.tenant_id      (jobs table)
//   3. contact.tenant_id  (contacts)
//   4. lead.tenant_id     (leads / pipeline_entries)
//   5. report.tenant_id   (roof_measurements, ai_measurement_jobs)
//   6. user → user_company_access (first row)
//   7. null + needs_company_resolution=true
//
// Returns { tenantId, source, needsResolution } — never throws.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export interface ResolveCompanyInput {
  supabase?: any;
  companyId?: string | null;   // accepted alias
  tenantId?: string | null;
  userId?: string | null;
  contactId?: string | null;
  jobId?: string | null;
  leadId?: string | null;
  pipelineEntryId?: string | null;
  reportId?: string | null;
  measurementJobId?: string | null;
}

export interface ResolveCompanyResult {
  tenantId: string | null;
  source:
    | "explicit"
    | "job"
    | "contact"
    | "lead"
    | "pipeline_entry"
    | "report"
    | "measurement_job"
    | "user_company_access"
    | "unresolved";
  needsResolution: boolean;
}

function svc() {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function resolveCompanyId(input: ResolveCompanyInput): Promise<ResolveCompanyResult> {
  const explicit = input.tenantId ?? input.companyId ?? null;
  if (explicit) return { tenantId: explicit, source: "explicit", needsResolution: false };

  const sb = input.supabase ?? svc();
  if (!sb) return { tenantId: null, source: "unresolved", needsResolution: true };

  const tryGet = async (table: string, id: string, source: ResolveCompanyResult["source"]) => {
    try {
      const { data } = await sb.from(table).select("tenant_id").eq("id", id).maybeSingle();
      if (data?.tenant_id) return { tenantId: data.tenant_id as string, source, needsResolution: false };
    } catch { /* swallow */ }
    return null;
  };

  if (input.jobId)             { const r = await tryGet("jobs", input.jobId, "job");                   if (r) return r; }
  if (input.contactId)         { const r = await tryGet("contacts", input.contactId, "contact");        if (r) return r; }
  if (input.leadId)            { const r = await tryGet("leads", input.leadId, "lead");                  if (r) return r; }
  if (input.pipelineEntryId)   { const r = await tryGet("pipeline_entries", input.pipelineEntryId, "pipeline_entry"); if (r) return r; }
  if (input.reportId)          { const r = await tryGet("roof_measurements", input.reportId, "report"); if (r) return r; }
  if (input.measurementJobId)  { const r = await tryGet("ai_measurement_jobs", input.measurementJobId, "measurement_job"); if (r) return r; }

  if (input.userId) {
    try {
      const { data } = await sb
        .from("user_company_access")
        .select("tenant_id")
        .eq("user_id", input.userId)
        .limit(1)
        .maybeSingle();
      if (data?.tenant_id) return { tenantId: data.tenant_id as string, source: "user_company_access", needsResolution: false };
    } catch { /* swallow */ }
  }

  return { tenantId: null, source: "unresolved", needsResolution: true };
}
