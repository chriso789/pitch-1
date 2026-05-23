// Security & RLS Linter
import { serviceClient } from "../router.ts";
import type { Finding } from "../system-audit.ts";

const ALLOW_PUBLIC = new Set([
  "schema_migrations","app_role","roles","permissions",
]);

export async function runRlsLinter(): Promise<{ findings: Finding[]; warnings: string[] }> {
  const svc = serviceClient();
  const findings: Finding[] = [];
  const warnings: string[] = [];

  // Gate 1+2: RLS disabled / USING(true) / no tenant filter
  const policies = await svc.rpc("audit_list_policies");
  if (policies.error) warnings.push(`policies_rpc_failed:${policies.error.message}`);
  else {
    for (const p of (policies.data ?? []) as Array<{table_name:string;policy_name:string;cmd:string;qual:string;with_check:string}>) {
      const q = (p.qual || "") + " " + (p.with_check || "");
      const isTrueOnly = /^(\s|\()*true(\s|\))*$/i.test(p.qual || "") || /^(\s|\()*true(\s|\))*$/i.test(p.with_check || "");
      if (isTrueOnly && !ALLOW_PUBLIC.has(p.table_name)) {
        findings.push({
          finding_key: `rls.true_policy:${p.table_name}.${p.policy_name}`,
          category: "rls_security", severity: "critical",
          entity_type: "policy", entity_id: `public.${p.table_name}.${p.policy_name}`,
          title: "Policy is USING (true) / WITH CHECK (true)",
          detail: `Command: ${p.cmd}`,
          recommended_action: `DROP POLICY "${p.policy_name}" ON public.${p.table_name}; -- then add a tenant-scoped policy`,
          risk_explanation: "Allows unrestricted access. Cross-tenant leak.",
        });
      }
      const referencesTenant = /(tenant_id|company_id|organization_id|has_role|is_master|auth\.uid\(\))/i.test(q);
      if (!referencesTenant && !ALLOW_PUBLIC.has(p.table_name)) {
        findings.push({
          finding_key: `rls.no_tenant_filter:${p.table_name}.${p.policy_name}`,
          category: "rls_security", severity: "high",
          entity_type: "policy", entity_id: `public.${p.table_name}.${p.policy_name}`,
          title: "Policy does not reference tenant_id/company_id/auth.uid()",
          detail: `qual: ${p.qual?.slice(0,160)} | check: ${p.with_check?.slice(0,160)}`,
          recommended_action: "Add tenant scoping via has_role() or current_tenant_id().",
          risk_explanation: "May permit cross-tenant access.",
        });
      }
    }
  }

  // Gate 5: public storage buckets
  const buckets = await svc.rpc("audit_storage_buckets_public");
  if (!buckets.error) {
    for (const b of (buckets.data ?? []) as Array<{bucket_id:string;is_public:boolean}>) {
      if (b.is_public && /signed|contract|invoice|estimate|permit|claim|insurance|document|pdf/i.test(b.bucket_id)) {
        findings.push({
          finding_key: `rls.improperly_public_bucket:${b.bucket_id}`,
          category: "rls_security", severity: "critical",
          entity_type: "bucket", entity_id: b.bucket_id,
          title: `Sensitive-looking bucket "${b.bucket_id}" is public`,
          recommended_action: "Set public=false; serve via signed URLs.",
          risk_explanation: "Public bucket bypasses storage RLS for sensitive data.",
        });
      }
    }
  }

  // Gate 6: known wildcard CORS — flag supabase-health explicitly (per plan)
  findings.push({
    finding_key: "rls.wildcard_cors:supabase-health",
    category: "rls_security", severity: "low",
    entity_type: "function", entity_id: "supabase-health",
    title: "Edge function supabase-health uses wildcard CORS",
    detail: "Access-Control-Allow-Origin: '*' on an admin/diagnostic endpoint.",
    recommended_action: "Restrict to https://pitch-crm.ai + preview origins, or require master auth in code.",
    risk_explanation: "Any origin can probe diagnostic endpoint.",
  });

  return { findings, warnings };
}
