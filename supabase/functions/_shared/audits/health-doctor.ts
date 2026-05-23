// Health Doctor — read-only platform inspection
import { serviceClient } from "../router.ts";
import type { Finding } from "../system-audit.ts";

const TENANT_ALLOWLIST = new Set([
  "tenants","companies","app_role","roles","permissions",
  "user_roles","profiles","user_company_access",
  "system_audit_runs","system_audit_findings",
  "edge_function_audit","schema_migrations",
]);

export async function runHealthDoctor(): Promise<{ findings: Finding[]; warnings: string[] }> {
  const svc = serviceClient();
  const findings: Finding[] = [];
  const warnings: string[] = [];

  // ---- RLS disabled / no policies ----
  const tables = await svc.rpc("audit_list_public_tables");
  if (tables.error) {
    warnings.push(`tables_rpc_failed:${tables.error.message}`);
  } else {
    for (const t of (tables.data ?? []) as Array<{table_name:string;rls_enabled:boolean;policy_count:number}>) {
      if (!t.rls_enabled && !TENANT_ALLOWLIST.has(t.table_name)) {
        findings.push({
          finding_key: `db.rls.disabled:${t.table_name}`,
          category: "health", severity: "critical",
          entity_type: "table", entity_id: `public.${t.table_name}`,
          title: "Table has RLS disabled",
          detail: `Public-schema table public.${t.table_name} has row-level security turned off.`,
          recommended_action: `ALTER TABLE public.${t.table_name} ENABLE ROW LEVEL SECURITY;`,
          risk_explanation: "Any authenticated user can read/write all rows.",
        });
      } else if (t.rls_enabled && Number(t.policy_count) === 0 && !TENANT_ALLOWLIST.has(t.table_name)) {
        findings.push({
          finding_key: `db.rls.no_policy:${t.table_name}`,
          category: "health", severity: "high",
          entity_type: "table", entity_id: `public.${t.table_name}`,
          title: "RLS enabled but no policies defined",
          detail: `public.${t.table_name} has RLS on but zero policies — effectively no rows are accessible to non-service-role callers.`,
          recommended_action: "Add at least one SELECT policy referencing tenant_id/company_id.",
          risk_explanation: "Either over-locks (legit users blocked) or signals an incomplete migration.",
        });
      }
    }
  }

  // ---- Tenant column presence ----
  const cols = await svc.rpc("audit_list_columns_by_name", { _column_names: ["tenant_id","company_id","organization_id"] });
  if (!cols.error && tables.data) {
    const withTenant = new Set<string>(((cols.data ?? []) as Array<{table_name:string}>).map(c=>c.table_name));
    for (const t of tables.data as Array<{table_name:string}>) {
      if (TENANT_ALLOWLIST.has(t.table_name)) continue;
      if (!withTenant.has(t.table_name)) {
        findings.push({
          finding_key: `db.tenant_missing:${t.table_name}`,
          category: "health", severity: "high",
          entity_type: "table", entity_id: `public.${t.table_name}`,
          title: "Table missing tenant_id/company_id column",
          detail: `public.${t.table_name} has no tenant_id, company_id, or organization_id.`,
          recommended_action: `ALTER TABLE public.${t.table_name} ADD COLUMN tenant_id uuid REFERENCES public.tenants(id);`,
          risk_explanation: "Without a tenant column, RLS cannot enforce per-tenant isolation.",
        });
      }
    }
  }

  // ---- Dead tuples ----
  const stats = await svc.rpc("audit_pg_stat_user_tables");
  if (!stats.error) {
    for (const r of (stats.data ?? []) as Array<{table_name:string;n_live_tup:number;n_dead_tup:number}>) {
      const live = Number(r.n_live_tup), dead = Number(r.n_dead_tup);
      if (live + dead > 1000 && dead / (live + dead) > 0.4) {
        findings.push({
          finding_key: `db.bloat:${r.table_name}`,
          category: "health", severity: "medium",
          entity_type: "table", entity_id: `public.${r.table_name}`,
          title: `Table has ${Math.round(100*dead/(live+dead))}% dead tuples`,
          detail: `${dead} dead / ${live} live`,
          recommended_action: `VACUUM (ANALYZE) public.${r.table_name};`,
          risk_explanation: "Bloat slows scans and inflates disk usage.",
        });
      }
    }
  }

  // ---- Slow queries ----
  const slow = await svc.rpc("audit_pg_stat_statements", { _limit: 25 });
  if (slow.error) warnings.push(`pg_stat_statements_unavailable:${slow.error.message}`);
  else {
    for (const q of (slow.data ?? []) as Array<{mean_ms:number;calls:number;total_s:number;query_excerpt:string}>) {
      if (Number(q.mean_ms) > 1000) {
        findings.push({
          finding_key: `db.slow_query:${q.query_excerpt.slice(0,60)}`,
          category: "health", severity: "high",
          entity_type: "query", entity_id: q.query_excerpt.slice(0,80),
          title: `Slow query: mean ${q.mean_ms}ms over ${q.calls} calls`,
          evidence: q,
          recommended_action: "Run EXPLAIN (ANALYZE, BUFFERS) and add an index or rewrite.",
          risk_explanation: "User-facing latency and connection saturation.",
        });
      }
    }
  }

  // ---- Public storage buckets ----
  const buckets = await svc.rpc("audit_storage_buckets_public");
  if (!buckets.error) {
    for (const b of (buckets.data ?? []) as Array<{bucket_id:string;is_public:boolean}>) {
      if (b.is_public) {
        findings.push({
          finding_key: `storage.public_bucket:${b.bucket_id}`,
          category: "health", severity: "medium",
          entity_type: "bucket", entity_id: b.bucket_id,
          title: `Storage bucket "${b.bucket_id}" is public`,
          recommended_action: "Verify intentionally public. If tenant data, set public=false and use signed URLs.",
          risk_explanation: "Public buckets bypass storage RLS.",
        });
      }
    }
  }

  // ---- function_cache size ----
  const fc = await svc.from("function_cache").select("expires_at", { count: "exact", head: false }).limit(1);
  if (!fc.error && fc.count !== null) {
    const expired = await svc.from("function_cache").select("*", { count: "exact", head: true }).lt("expires_at", new Date().toISOString());
    findings.push({
      finding_key: "cache.function_cache_size",
      category: "health",
      severity: fc.count > 100000 ? "high" : fc.count > 10000 ? "medium" : "info",
      entity_type: "table", entity_id: "public.function_cache",
      title: `function_cache has ${fc.count} rows (${expired.count ?? 0} expired)`,
      recommended_action: "Run Phase 2 cleanup-worker to purge expired rows.",
      risk_explanation: "Unbounded cache growth degrades read performance.",
    });
  } else if (fc.error && !/relation .* does not exist/i.test(fc.error.message)) {
    warnings.push(`function_cache_check:${fc.error.message}`);
  }

  return { findings, warnings };
}
