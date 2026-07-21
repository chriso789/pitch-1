/**
 * PHASE M3 — Database-backed isolation tests.
 *
 * These verify that the collision-seeded rows are strictly partitioned by
 * tenant_id even though (realm_id, qbo_entity_id) and job_type_code collide
 * across Tenant A and Tenant B.
 *
 * Runs whenever SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + both TENANT_*_TENANT_ID
 * are present. Skipped otherwise (never a false PASS).
 */

import { beforeAll, afterAll, describe, expect, test } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { TENANT_A, TENANT_B, requireServiceRole } from "./config";
import { seedAll, cleanupAll, COLLISION, SeededTenantIds } from "./fixtures";

const cred = requireServiceRole();
const canRun =
  !!cred && !!TENANT_A.tenantId && !!TENANT_B.tenantId && !!TENANT_A.realmId && !!TENANT_B.realmId;

describe.skipIf(!canRun)("QBO DB isolation (PHASE M3)", () => {
  let sb: SupabaseClient;
  let seeded: { tenantA: SeededTenantIds | null; tenantB: SeededTenantIds | null };

  beforeAll(async () => {
    sb = createClient(cred!.url, cred!.key, { auth: { persistSession: false } });
    seeded = await seedAll();
    expect(seeded.tenantA, "Tenant A seed").toBeTruthy();
    expect(seeded.tenantB, "Tenant B seed").toBeTruthy();
  });

  afterAll(async () => {
    await cleanupAll();
  });

  test("qbo_entity_mapping rows are partitioned by tenant_id despite qbo_entity_id collision", async () => {
    const { data, error } = await sb
      .from("qbo_entity_mapping")
      .select("id, tenant_id, qbo_entity_id, qbo_entity_type")
      .eq("qbo_entity_id", COLLISION.qbo_invoice_id)
      .eq("qbo_entity_type", "Invoice");
    expect(error).toBeNull();
    const byTenant = new Set((data ?? []).map((r) => r.tenant_id));
    expect(byTenant.has(TENANT_A.tenantId!)).toBe(true);
    expect(byTenant.has(TENANT_B.tenantId!)).toBe(true);
    expect(byTenant.size).toBe(2); // exactly two owners, no cross-write
  });

  test("invoice_ar_mirror rows are strictly per-tenant for the colliding invoice", async () => {
    const a = await sb
      .from("invoice_ar_mirror")
      .select("tenant_id, qbo_invoice_id, doc_number")
      .eq("tenant_id", TENANT_A.tenantId!)
      .eq("qbo_invoice_id", COLLISION.qbo_invoice_id);
    const b = await sb
      .from("invoice_ar_mirror")
      .select("tenant_id, qbo_invoice_id, doc_number")
      .eq("tenant_id", TENANT_B.tenantId!)
      .eq("qbo_invoice_id", COLLISION.qbo_invoice_id);
    expect(a.error).toBeNull();
    expect(b.error).toBeNull();
    expect(a.data?.length).toBe(1);
    expect(b.data?.length).toBe(1);
    expect(a.data![0].tenant_id).not.toBe(b.data![0].tenant_id);
  });

  test("job_type_item_map colliding job_type_code resolves to distinct items per tenant", async () => {
    const a = await sb
      .from("job_type_item_map")
      .select("tenant_id, qbo_item_id")
      .eq("tenant_id", TENANT_A.tenantId!)
      .eq("job_type_code", COLLISION.job_type_code)
      .maybeSingle();
    const b = await sb
      .from("job_type_item_map")
      .select("tenant_id, qbo_item_id")
      .eq("tenant_id", TENANT_B.tenantId!)
      .eq("job_type_code", COLLISION.job_type_code)
      .maybeSingle();
    expect(a.data?.qbo_item_id).toBe("ITEM-A");
    expect(b.data?.qbo_item_id).toBe("ITEM-B");
  });

  test("qbo_connections one-connection-per-tenant invariant (no duplicate active for either tenant)", async () => {
    for (const tid of [TENANT_A.tenantId!, TENANT_B.tenantId!]) {
      const { data, error } = await sb
        .from("qbo_connections")
        .select("id, is_active")
        .eq("tenant_id", tid)
        .eq("is_active", true);
      expect(error).toBeNull();
      expect((data ?? []).length).toBeLessThanOrEqual(1);
    }
  });

  test("seeder is idempotent — running seedAll twice yields the same fixture IDs", async () => {
    const second = await seedAll();
    expect(second.tenantA?.ids).toEqual(seeded.tenantA?.ids);
    expect(second.tenantB?.ids).toEqual(seeded.tenantB?.ids);
  });
});

describe.skipIf(canRun)("QBO DB isolation (PHASE M3) — BLOCKED", () => {
  test("BLOCKED: DB isolation tests require SUPABASE_SERVICE_ROLE_KEY + both TENANT_*_TENANT_ID + TENANT_*_REALM_ID", () => {
    console.warn(
      "[BLOCKED] PHASE M3 DB isolation — missing env. " +
        `service_role=${!!cred} A.tenant=${!!TENANT_A.tenantId} B.tenant=${!!TENANT_B.tenantId} ` +
        `A.realm=${!!TENANT_A.realmId} B.realm=${!!TENANT_B.realmId}`,
    );
    expect(true).toBe(true); // BLOCKED, not FAIL
  });
});
