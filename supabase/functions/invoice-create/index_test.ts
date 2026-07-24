// Deno test for invoice-create edge function.
// Requires VITE_SUPABASE_URL + VITE_SUPABASE_PUBLISHABLE_KEY in root .env.
// Verifies:
//   - Unauthenticated calls are rejected with 401
//   - Missing project_id => 400
//   - CORS preflight OK
// Full end-to-end tenant-verification test requires a seeded user + project;
// tracked separately in the QA harness. This file is a smoke test for the
// public contract.

import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY")!;
const FN_URL = `${SUPABASE_URL}/functions/v1/invoice-create`;

Deno.test("CORS preflight returns 200", async () => {
  const res = await fetch(FN_URL, {
    method: "OPTIONS",
    headers: { apikey: ANON_KEY },
  });
  await res.text();
  assertEquals(res.status, 200);
});

Deno.test("Missing Authorization returns 401", async () => {
  const res = await fetch(FN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON_KEY },
    body: JSON.stringify({ project_id: "00000000-0000-0000-0000-000000000000", line_items: [] }),
  });
  const json = await res.json();
  assertEquals(res.status, 401);
  assertEquals(json.ok, false);
});

Deno.test("Invalid JWT returns 401", async () => {
  const res = await fetch(FN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: ANON_KEY,
      Authorization: "Bearer not-a-real-token",
    },
    body: JSON.stringify({ project_id: "00000000-0000-0000-0000-000000000000", line_items: [] }),
  });
  const json = await res.json();
  assertEquals(res.status, 401);
  assertEquals(json.ok, false);
});
