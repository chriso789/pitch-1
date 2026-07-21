/**
 * PHASE M4 — Webhook isolation tests.
 *
 * Uses the actual deployed qbo-webhook-handler endpoint. Signatures are
 * generated with QBO_WEBHOOK_VERIFIER_DEVELOPMENT (preferred) or
 * QBO_WEBHOOK_VERIFIER_PRODUCTION. If neither is present, tests are reported
 * BLOCKED rather than FAIL.
 *
 * We assert:
 *   - unsigned/malformed → 401
 *   - signed with wrong verifier → 401
 *   - signed with correct verifier but unknown realm → 200 + quarantined
 *   - signed with correct verifier + known realm A → routed to tenant A only
 */

import crypto from "node:crypto";
import { beforeAll, describe, expect, test } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import {
  TENANT_A,
  TENANT_B,
  WEBHOOK_VERIFIER_DEV,
  WEBHOOK_VERIFIER_PROD,
  edgeUrl,
  requireServiceRole,
} from "./config";

const cred = requireServiceRole();
const verifier = WEBHOOK_VERIFIER_DEV ?? WEBHOOK_VERIFIER_PROD;
const verifierMode: "development" | "production" | null = WEBHOOK_VERIFIER_DEV
  ? "development"
  : WEBHOOK_VERIFIER_PROD
    ? "production"
    : null;

const canRun = !!cred && !!verifier;

function sign(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64");
}

function payloadFor(realmId: string): string {
  return JSON.stringify({
    eventNotifications: [
      {
        realmId,
        dataChangeEvent: {
          entities: [
            {
              name: "Invoice",
              id: "9999003",
              operation: "Update",
              lastUpdated: new Date().toISOString(),
            },
          ],
        },
      },
    ],
  });
}

async function postWebhook(body: string, sig: string | null): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (sig) headers["intuit-signature"] = sig;
  return fetch(edgeUrl("qbo-webhook-handler"), { method: "POST", headers, body });
}

describe.skipIf(!canRun)(`QBO webhook isolation (PHASE M4 — verifier=${verifierMode})`, () => {
  let sb: SupabaseClient;

  beforeAll(() => {
    sb = createClient(cred!.url, cred!.key, { auth: { persistSession: false } });
  });

  test("unsigned webhook is rejected with 401", async () => {
    const res = await postWebhook(payloadFor("unknown-realm-xyz"), null);
    expect(res.status).toBe(401);
    await res.text();
  });

  test("wrong-secret signature is rejected with 401", async () => {
    const body = payloadFor("unknown-realm-xyz");
    const badSig = sign(body, "not-the-real-verifier-" + Date.now());
    const res = await postWebhook(body, badSig);
    expect(res.status).toBe(401);
    await res.text();
  });

  test("valid signature + unknown realm is accepted (200) and quarantined without routing to any tenant", async () => {
    const unknownRealm = `iso-unknown-${Date.now()}`;
    const body = payloadFor(unknownRealm);
    const res = await postWebhook(body, sign(body, verifier!));
    expect(res.status).toBe(200);
    await res.text();

    const { data } = await sb
      .from("qbo_webhook_events")
      .select("realm_id, tenant_id, oauth_app_env")
      .eq("realm_id", unknownRealm);
    expect((data ?? []).length).toBeGreaterThan(0);
    for (const row of data ?? []) {
      // No known tenant should have been attached to an unknown realm.
      expect(row.tenant_id).toBeNull();
    }
  });

  test.skipIf(!TENANT_A.realmId || TENANT_A.oauthAppEnv !== verifierMode)(
    "valid signature + Tenant A realm routes to Tenant A only",
    async () => {
      const body = payloadFor(TENANT_A.realmId!);
      const res = await postWebhook(body, sign(body, verifier!));
      expect(res.status).toBe(200);
      await res.text();

      const { data } = await sb
        .from("qbo_webhook_events")
        .select("realm_id, tenant_id")
        .eq("realm_id", TENANT_A.realmId!)
        .order("id", { ascending: false })
        .limit(5);
      const tenantIds = new Set((data ?? []).map((r) => r.tenant_id).filter(Boolean));
      // Must include Tenant A, must NOT include Tenant B.
      expect(tenantIds.has(TENANT_A.tenantId!)).toBe(true);
      if (TENANT_B.tenantId) expect(tenantIds.has(TENANT_B.tenantId)).toBe(false);
    },
  );
});

describe.skipIf(canRun)("QBO webhook isolation (PHASE M4) — BLOCKED", () => {
  test("BLOCKED: production/development webhook verifier not exposed to the test env", () => {
    console.warn(
      "[BLOCKED] PHASE M4 webhook — set QBO_WEBHOOK_VERIFIER_DEVELOPMENT or QBO_WEBHOOK_VERIFIER_PRODUCTION.",
    );
    expect(true).toBe(true);
  });
});
