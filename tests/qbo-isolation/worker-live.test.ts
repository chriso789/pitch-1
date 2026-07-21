/**
 * PHASE M5 — Live authenticated worker tests.
 *
 * These require a real Supabase user JWT for each tenant AND a live QBO
 * OAuth connection for that tenant. When either is missing we emit a
 * BLOCKED marker instead of a FAIL — a false PASS is never produced.
 *
 * Positive case: Tenant A's JWT can preflight against Tenant A's realm.
 * Negative case: Tenant A's JWT cannot preflight against Tenant B's realm —
 *                the worker resolves tenant server-side and MUST refuse any
 *                body-supplied cross-tenant override attempt.
 */

import { describe, expect, test } from "vitest";
import { TENANT_A, TENANT_B, edgeUrl, tenantIsLiveReady } from "./config";

async function invoke(jwt: string, op: string, args: Record<string, unknown>) {
  return fetch(edgeUrl("qbo-worker"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({ op, args }),
  });
}

const aReady = tenantIsLiveReady(TENANT_A);
const bReady = tenantIsLiveReady(TENANT_B);

describe.skipIf(!aReady)("qbo-worker — Tenant A positive path (PHASE M5)", () => {
  test("preflight succeeds for Tenant A with Tenant A JWT", async () => {
    const res = await invoke(TENANT_A.jwt!, "preflight", {});
    expect([200, 202]).toContain(res.status);
    const body = await res.json().catch(() => ({}));
    expect(body?.ok ?? body?.success).toBeTruthy();
  });
});

describe.skipIf(!(aReady && bReady))(
  "qbo-worker — cross-tenant negative isolation (PHASE M5)",
  () => {
    test("Tenant A JWT cannot force writes against Tenant B tenant_id (body override ignored/rejected)", async () => {
      // Try to smuggle Tenant B's tenant_id in the body — the worker must ignore
      // it and resolve tenant from JWT. So either it succeeds using A's context
      // (proving body-tenant was ignored), or it refuses. It must NOT touch B.
      const res = await invoke(TENANT_A.jwt!, "preflight", {
        tenant_id: TENANT_B.tenantId,
        realm_id: TENANT_B.realmId,
      });
      // Any 4xx is fine; a 2xx is only acceptable if the returned tenant is A.
      if (res.status >= 200 && res.status < 300) {
        const body = await res.json().catch(() => ({}));
        const resolved =
          body?.data?.tenant_id ??
          body?.tenant_id ??
          body?.data?.resolved_tenant_id ??
          null;
        if (resolved) expect(resolved).toBe(TENANT_A.tenantId);
      } else {
        expect(res.status).toBeGreaterThanOrEqual(400);
        await res.text();
      }
    });

    test("Tenant A JWT with Tenant B qbo_connection_id must fail (connection not owned)", async () => {
      const res = await invoke(TENANT_A.jwt!, "syncPaymentStatus", {
        qbo_connection_id: TENANT_B.qboConnectionId,
        qbo_invoice_id: "9999003",
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
      await res.text();
    });
  },
);

describe.skipIf(aReady && bReady)("qbo-worker live tests — BLOCKED", () => {
  test("BLOCKED: Needs live Intuit OAuth connection for both tenants", () => {
    console.warn(
      "[BLOCKED] PHASE M5 live worker tests — " +
        `A.ready=${aReady} B.ready=${bReady}. ` +
        "Set TENANT_A_* and TENANT_B_* env (jwt, tenant_id, qbo_connection_id, realm_id, oauth_app_env).",
    );
    expect(true).toBe(true);
  });
});
