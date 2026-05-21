// Spec-named admin endpoint. Marks a payout row paid.
import { corsHeaders, json, requireUser, svcClient } from "../_shared/crm-referral.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const u = await requireUser(req);
    if ("error" in u) return u.error;
    const { crm_referral_payout_id, payment_reference, notes } = (await req.json()) || {};
    if (!crm_referral_payout_id) return json({ error: "crm_referral_payout_id required" }, 400);
    const sb = svcClient();
    const { data, error } = await sb.from("crm_referral_payouts").update({
      payout_status: "paid",
      paid_at: new Date().toISOString(),
      payment_reference, notes,
    }).eq("id", crm_referral_payout_id).select().single();
    if (error) return json({ error: error.message }, 400);
    return json({ success: true, payout: data, marked_by: u.userId });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
