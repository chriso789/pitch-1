// Tenant Isolation Auditor
import { serviceClient } from "../router.ts";
import type { Finding } from "../system-audit.ts";

const ALLOWLIST = new Set([
  "tenants","companies","app_role","roles","permissions",
  "user_roles","profiles","user_company_access",
  "system_audit_runs","system_audit_findings",
  "edge_function_audit","schema_migrations",
]);

export async function runTenantIsolation(): Promise<{ findings: Finding[]; warnings: string[] }> {
  const svc = serviceClient();
  const findings: Finding[] = [];
  const warnings: string[] = [];

  // Gate 1: schema-level tenant column presence
  const tables = await svc.rpc("audit_list_public_tables");
  const cols = await svc.rpc("audit_list_columns_by_name", { _column_names: ["tenant_id","company_id","organization_id"] });
  if (tables.error) warnings.push(`tables_rpc_failed:${tables.error.message}`);
  if (cols.error) warnings.push(`cols_rpc_failed:${cols.error.message}`);

  if (!tables.error && !cols.error) {
    const withTenant = new Set<string>(((cols.data ?? []) as Array<{table_name:string}>).map(c=>c.table_name));
    for (const t of (tables.data ?? []) as Array<{table_name:string}>) {
      if (ALLOWLIST.has(t.table_name)) continue;
      if (!withTenant.has(t.table_name)) {
        findings.push({
          finding_key: `tenant.no_column:${t.table_name}`,
          category: "tenant_isolation", severity: "critical",
          entity_type: "table", entity_id: `public.${t.table_name}`,
          title: "Tenant-owned table missing tenant_id/company_id",
          recommended_action: `ALTER TABLE public.${t.table_name} ADD COLUMN tenant_id uuid REFERENCES public.tenants(id);`,
          risk_explanation: "Cannot enforce per-tenant RLS without a tenant column.",
        });
      }
    }
  }

  // Gate 2: policy text checks
  const policies = await svc.rpc("audit_list_policies");
  if (!policies.error) {
    for (const p of (policies.data ?? []) as Array<{table_name:string;policy_name:string;cmd:string;qual:string;with_check:string}>) {
      if (ALLOWLIST.has(p.table_name)) continue;
      const q = (p.qual||"") + " " + (p.with_check||"");
      if (!/(tenant_id|company_id|organization_id|has_role|is_master)/i.test(q)) {
        findings.push({
          finding_key: `tenant.policy_no_filter:${p.table_name}.${p.policy_name}`,
          category: "tenant_isolation", severity: "high",
          entity_type: "policy", entity_id: `public.${p.table_name}.${p.policy_name}`,
          title: "Policy on tenant-owned table lacks tenant filter",
          detail: `cmd=${p.cmd} qual=${p.qual?.slice(0,160)}`,
          recommended_action: "Add tenant_id=current_tenant_id() (or has_role check) to USING/WITH CHECK.",
          risk_explanation: "Cross-tenant data leak risk.",
        });
      }
    }
  }

  // Gate 3: storage objects with non-UUID first segment
  const orphans = await svc.rpc("audit_orphan_storage_first_segment", { _limit: 50 });
  if (!orphans.error && (orphans.data?.length ?? 0) > 0) {
    findings.push({
      finding_key: "tenant.storage_non_uuid_prefix",
      category: "tenant_isolation", severity: "high",
      entity_type: "bucket", entity_id: "storage.objects",
      title: `${orphans.data.length} storage objects have non-UUID first path segment (sample of 50)`,
      evidence: orphans.data,
      recommended_action: "Storage RLS requires {tenant_id}/... — re-key or quarantine these objects in Phase 2.",
      risk_explanation: "Storage RLS that depends on first segment as tenant_id cannot apply.",
    });
  }

  return { findings, warnings };
}
