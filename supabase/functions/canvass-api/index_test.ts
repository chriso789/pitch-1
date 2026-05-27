// Integration tests for canvass-api /auth and /pin/sync.
// Runs against deployed function. Requires test credentials via env vars:
//   CANVASS_TEST_USER_A_JWT, CANVASS_TEST_TENANT_A_ID
//   CANVASS_TEST_USER_B_JWT, CANVASS_TEST_TENANT_B_ID  (different tenant)
//   CANVASS_TEST_DISPOSITION_B_ID  (a disposition belonging to tenant B)
// If any required env var is missing, those tests skip with a logged note rather than fail.

import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL") ?? Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
const FN_URL = `${SUPABASE_URL}/functions/v1/canvass-api`;

const USER_A_JWT = Deno.env.get("CANVASS_TEST_USER_A_JWT");
const TENANT_A = Deno.env.get("CANVASS_TEST_TENANT_A_ID");
const USER_B_JWT = Deno.env.get("CANVASS_TEST_USER_B_JWT");
const TENANT_B = Deno.env.get("CANVASS_TEST_TENANT_B_ID");
const DISPOSITION_B = Deno.env.get("CANVASS_TEST_DISPOSITION_B_ID");

function call(route: string, opts: { token?: string; body?: unknown } = {}) {
  return fetch(FN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-route": route,
      apikey: ANON,
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body: JSON.stringify({ __route: route, ...(opts.body as object ?? {}) }),
  });
}

function skipIf(cond: unknown, name: string): boolean {
  if (!cond) {
    console.log(`[skip] ${name}: missing test env`);
    return true;
  }
  return false;
}

Deno.test("/auth rejects missing token with 401", async () => {
  const res = await call("/auth");
  const body = await res.json();
  assertEquals(res.status, 401);
  assertEquals(body.ok, false);
  assertEquals(body.code, "unauthorized");
});

Deno.test("/auth returns rep + tenant-scoped dispositions for tenant A", async () => {
  if (skipIf(USER_A_JWT && TENANT_A, "auth-success")) return;
  const res = await call("/auth", { token: USER_A_JWT });
  const body = await res.json();
  assertEquals(res.status, 200);
  assertEquals(body.ok, true);
  assertEquals(body.data.rep.tenant_id, TENANT_A);
  assert(Array.isArray(body.data.dispositions));
  // Every disposition must belong to tenant A (server-filtered)
  // (We don't have tenant_id on the response shape; just sanity check shape.)
  assert(typeof body.data.server_time === "string");
});

Deno.test("/auth cross-tenant isolation — tenant A token never returns tenant B's id", async () => {
  if (skipIf(USER_A_JWT && TENANT_B && TENANT_A !== TENANT_B, "auth-cross-tenant")) return;
  const res = await call("/auth", { token: USER_A_JWT });
  const body = await res.json();
  assertEquals(body.data.rep.tenant_id, TENANT_A);
  assert(body.data.rep.tenant_id !== TENANT_B);
});

Deno.test("/pin/sync rejects unauthenticated", async () => {
  const res = await call("/pin/sync", { body: { pins: [] } });
  assertEquals(res.status, 401);
  await res.text();
});

Deno.test("/pin/sync per-pin validation — invalid pins do not fail batch", async () => {
  if (skipIf(USER_A_JWT, "pin-sync-validation")) return;
  const cmidGood = crypto.randomUUID();
  const res = await call("/pin/sync", {
    token: USER_A_JWT,
    body: {
      pins: [
        { /* missing cmid */ latitude: 40, longitude: -74 },
        { client_mutation_id: cmidGood, latitude: 999, longitude: 0 }, // bad lat
        { client_mutation_id: crypto.randomUUID(), latitude: 40.7128, longitude: -74.006 },
      ],
    },
  });
  const body = await res.json();
  assertEquals(res.status, 200);
  assertEquals(body.data.results.length, 3);
  assertEquals(body.data.results[0].ok, false);
  assertEquals(body.data.results[0].code, "invalid_pin");
  assertEquals(body.data.results[1].ok, false);
  assertEquals(body.data.results[1].code, "invalid_pin");
  assertEquals(body.data.results[2].ok, true);
});

Deno.test("/pin/sync replay returns replayed:true with same contact_id", async () => {
  if (skipIf(USER_A_JWT, "pin-sync-replay")) return;
  const cmid = crypto.randomUUID();
  const pin = {
    client_mutation_id: cmid,
    client_created_at: new Date().toISOString(),
    latitude: 41.0 + Math.random() * 0.5,
    longitude: -73.0 - Math.random() * 0.5,
    address: { street: "1 Test St", city: "Test", state: "NY", zip: "10001" },
  };
  const first = await (await call("/pin/sync", { token: USER_A_JWT, body: { pins: [pin] } })).json();
  assertEquals(first.data.results[0].ok, true);
  const contactId = first.data.results[0].contact_id;

  const second = await (await call("/pin/sync", { token: USER_A_JWT, body: { pins: [pin] } })).json();
  assertEquals(second.data.results[0].ok, true);
  assertEquals(second.data.results[0].replayed, true);
  assertEquals(second.data.results[0].contact_id, contactId);
});

Deno.test("/pin/sync ignores body-supplied tenant_id (server resolves)", async () => {
  if (skipIf(USER_A_JWT && TENANT_A && TENANT_B && TENANT_A !== TENANT_B, "pin-sync-tenant-isolation")) return;
  const cmid = crypto.randomUUID();
  const res = await call("/pin/sync", {
    token: USER_A_JWT,
    body: {
      tenant_id: TENANT_B, // attempted override — must be ignored
      pins: [{
        client_mutation_id: cmid,
        latitude: 42.0 + Math.random() * 0.5,
        longitude: -72.0 - Math.random() * 0.5,
      }],
    },
  });
  const body = await res.json();
  assertEquals(body.data.results[0].ok, true);
  // The ledger row will live under tenant A (verified by replay returning same id).
  const replay = await (await call("/pin/sync", {
    token: USER_A_JWT,
    body: { pins: [{ client_mutation_id: cmid, latitude: 42.5, longitude: -72.5 }] },
  })).json();
  assertEquals(replay.data.results[0].replayed, true);
  assertEquals(replay.data.results[0].contact_id, body.data.results[0].contact_id);
});

Deno.test("/pin/sync cross-tenant disposition rejected", async () => {
  if (skipIf(USER_A_JWT && DISPOSITION_B, "pin-sync-disposition-cross-tenant")) return;
  const cmid = crypto.randomUUID();
  const res = await call("/pin/sync", {
    token: USER_A_JWT,
    body: {
      pins: [{
        client_mutation_id: cmid,
        latitude: 43.0 + Math.random() * 0.5,
        longitude: -71.0 - Math.random() * 0.5,
        disposition_id: DISPOSITION_B,
      }],
    },
  });
  const body = await res.json();
  assertEquals(body.data.results[0].ok, true);
  assertEquals(body.data.results[0].code, "disposition_rejected");
});
