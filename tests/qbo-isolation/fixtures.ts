/**
 * QBO Isolation Fixture Seeder (PHASE M2)
 *
 * Idempotent. Running twice does not duplicate rows.
 *
 * All fixture rows are keyed by deterministic UUIDs derived from the tenant ID
 * so we can upsert on primary keys and safely re-seed. The seeder ONLY touches
 * tenants that were provided via env; it never fabricates tenants that don't
 * already exist in `tenants`.
 *
 * Seeded per tenant (when tenant_id + realm_id + qbo_connection_id are present):
 *   - qbo_entity_mapping rows (customer, project, invoice)   [collision keys]
 *   - invoice_ar_mirror row                                   [collision key]
 *   - job_type_item_map row                                   [collision key]
 *
 * Collision design: Tenant A and Tenant B are seeded with the SAME
 * (realm_id, qbo_entity_id) and SAME job_type_code so cross-tenant leakage
 * shows up immediately in the isolation tests.
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { TENANT_A, TENANT_B, TenantConfig, requireServiceRole } from "./config";

// Deterministic collision values shared across tenants.
export const COLLISION = {
  qbo_customer_id: "9999001",
  qbo_project_id: "9999002",
  qbo_invoice_id: "9999003",
  invoice_doc_number: "ISO-COLLIDE-001",
  job_type_code: "ISO_ROOF_REPAIR",
};

// Derive stable UUIDs from tenant_id so re-seed hits the same PKs.
function stableId(tenantId: string, tag: string): string {
  // very light deterministic hash → uuid v4-ish shape
  let h = 0;
  for (const c of tenantId + ":" + tag) h = (h * 31 + c.charCodeAt(0)) | 0;
  const hex = (Math.abs(h).toString(16) + "0".repeat(12)).slice(0, 12);
  return `00000000-0000-4000-8000-${hex}`;
}

export interface SeededTenantIds {
  tenant: TenantConfig;
  ids: {
    mapping_customer: string;
    mapping_project: string;
    mapping_invoice: string;
    ar_mirror: string;
    job_type_map: string;
  };
}

async function seedTenant(sb: SupabaseClient, t: TenantConfig): Promise<SeededTenantIds | null> {
  if (!t.tenantId || !t.realmId) return null;

  const ids = {
    mapping_customer: stableId(t.tenantId, "map-customer"),
    mapping_project: stableId(t.tenantId, "map-project"),
    mapping_invoice: stableId(t.tenantId, "map-invoice"),
    ar_mirror: stableId(t.tenantId, "ar-mirror"),
    job_type_map: stableId(t.tenantId, "job-type-map"),
  };

  const commonMap = {
    tenant_id: t.tenantId,
    realm_id: t.realmId,
  };

  // qbo_entity_mapping — upsert by PK.
  await sb.from("qbo_entity_mapping").upsert([
    {
      id: ids.mapping_customer,
      ...commonMap,
      entity_type: "contact",
      entity_id: stableId(t.tenantId, "contact-src"),
      qbo_entity_id: COLLISION.qbo_customer_id,
      qbo_entity_type: "Customer",
      metadata: { seeded_by: "qbo-isolation", tenant_label: t.label },
    },
    {
      id: ids.mapping_project,
      ...commonMap,
      entity_type: "project",
      entity_id: stableId(t.tenantId, "project-src"),
      qbo_entity_id: COLLISION.qbo_project_id,
      qbo_entity_type: "Project",
      metadata: { seeded_by: "qbo-isolation", tenant_label: t.label },
    },
    {
      id: ids.mapping_invoice,
      ...commonMap,
      entity_type: "invoice",
      entity_id: stableId(t.tenantId, "invoice-src"),
      qbo_entity_id: COLLISION.qbo_invoice_id,
      qbo_entity_type: "Invoice",
      metadata: { seeded_by: "qbo-isolation", tenant_label: t.label },
    },
  ], { onConflict: "id" });

  // invoice_ar_mirror
  await sb.from("invoice_ar_mirror").upsert(
    [{
      id: ids.ar_mirror,
      ...commonMap,
      qbo_invoice_id: COLLISION.qbo_invoice_id,
      doc_number: COLLISION.invoice_doc_number,
      total_amount: 1234.56,
      balance: 1234.56,
      status: "Unpaid",
    }],
    { onConflict: "id" },
  );

  // job_type_item_map — collision on job_type_code across tenants.
  await sb.from("job_type_item_map").upsert(
    [{
      id: ids.job_type_map,
      tenant_id: t.tenantId,
      job_type_code: COLLISION.job_type_code,
      qbo_item_id: `ITEM-${t.label}`,
      qbo_item_name: `Isolation Test Item ${t.label}`,
    }],
    { onConflict: "id" },
  );

  return { tenant: t, ids };
}

export async function seedAll(): Promise<{
  tenantA: SeededTenantIds | null;
  tenantB: SeededTenantIds | null;
  skipped: string[];
}> {
  const cred = requireServiceRole();
  if (!cred) {
    return {
      tenantA: null,
      tenantB: null,
      skipped: ["SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing — seeder skipped"],
    };
  }
  const sb = createClient(cred.url, cred.key, { auth: { persistSession: false } });
  const skipped: string[] = [];
  const tenantA = await seedTenant(sb, TENANT_A);
  if (!tenantA) skipped.push("TENANT_A_TENANT_ID / TENANT_A_REALM_ID missing");
  const tenantB = await seedTenant(sb, TENANT_B);
  if (!tenantB) skipped.push("TENANT_B_TENANT_ID / TENANT_B_REALM_ID missing");
  return { tenantA, tenantB, skipped };
}

export async function cleanupAll(): Promise<void> {
  const cred = requireServiceRole();
  if (!cred) return;
  const sb = createClient(cred.url, cred.key, { auth: { persistSession: false } });
  for (const t of [TENANT_A, TENANT_B]) {
    if (!t.tenantId) continue;
    const ids = [
      stableId(t.tenantId, "map-customer"),
      stableId(t.tenantId, "map-project"),
      stableId(t.tenantId, "map-invoice"),
    ];
    await sb.from("qbo_entity_mapping").delete().in("id", ids);
    await sb.from("invoice_ar_mirror").delete().eq("id", stableId(t.tenantId, "ar-mirror"));
    await sb.from("job_type_item_map").delete().eq("id", stableId(t.tenantId, "job-type-map"));
  }
}
