// Deno tests for the payment contract dedup guarantees.
// These exercise the database constraints directly using the service-role
// client — they verify that the same (provider, provider_payment_id) cannot
// produce two project_payments rows, and that the same stripe webhook
// event_id cannot be inserted twice.
//
// Run via the supabase--test_edge_functions tool.

import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL") ?? Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("SUPABASE_SERVICE_KEY") ??
  "";

const skip = !SUPABASE_URL || !SERVICE_ROLE;

Deno.test({
  name: "stripe_webhook_events.event_id is unique (duplicate insert rejected)",
  ignore: skip,
  fn: async () => {
    const svc = createClient(SUPABASE_URL, SERVICE_ROLE);
    const eventId = `evt_test_${crypto.randomUUID()}`;
    const a = await svc.from("stripe_webhook_events").insert({
      event_id: eventId, event_type: "test.event", signature_valid: true, accepted: true,
    });
    assertEquals(a.error, null);
    const b = await svc.from("stripe_webhook_events").insert({
      event_id: eventId, event_type: "test.event", signature_valid: true, accepted: true,
    });
    assert(b.error, "second insert should fail");
    assertEquals(b.error?.code, "23505");
    await svc.from("stripe_webhook_events").delete().eq("event_id", eventId);
  },
});

Deno.test({
  name: "project_payments unique on (provider, provider_payment_id)",
  ignore: skip,
  fn: async () => {
    const svc = createClient(SUPABASE_URL, SERVICE_ROLE);
    // grab any tenant/invoice we can use
    const { data: inv } = await svc
      .from("project_invoices")
      .select("id, tenant_id, pipeline_entry_id")
      .limit(1)
      .maybeSingle();
    if (!inv) return; // nothing to test against in this env

    const pid = `pi_test_${crypto.randomUUID()}`;
    const base = {
      tenant_id: inv.tenant_id,
      pipeline_entry_id: inv.pipeline_entry_id,
      invoice_id: inv.id,
      amount: 0.01,
      payment_method: "stripe",
      provider: "stripe",
      provider_payment_id: pid,
      payment_date: new Date().toISOString(),
      notes: "dedup test",
    };
    const a = await svc.from("project_payments").insert(base).select("id").single();
    assertEquals(a.error, null);
    const b = await svc.from("project_payments").insert(base);
    assert(b.error, "second insert should fail");
    assertEquals(b.error?.code, "23505");
    if (a.data?.id) await svc.from("project_payments").delete().eq("id", a.data.id);
  },
});
