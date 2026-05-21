import { corsHeaders, json, requireUser, svcClient, assertTenantAccess } from "../_shared/crm-referral.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const { userId, sb: usb, error } = await requireUser(req);
  if (error) return error;
  try {
    const { payout_id, notes } = await req.json();
    if (!payout_id) return json({ error: "payout_id required" }, 400);
    const sb = svcClient();
    const { data: p, error: e1 } = await sb.from("crm_referral_payouts").select("*").eq("id", payout_id).single();
    if (e1) throw e1;
    if (!(await assertTenantAccess(usb!, p.tenant_id))) return json({ error: "Forbidden" }, 403);
    const { data, error: e2 } = await sb.from("crm_referral_payouts").update({
      payout_status: "approved", approved_by: userId, approved_at: new Date().toISOString(), notes: notes ?? p.notes,
    }).eq("id", payout_id).select().single();
    if (e2) throw e2;
    return json({ success: true, payout: data });
  } catch (e) {
    console.error(e); return json({ error: (e as Error).message }, 500);
  }
});
