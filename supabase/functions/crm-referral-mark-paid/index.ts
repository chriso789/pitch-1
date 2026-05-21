import { corsHeaders, json, requireUser, svcClient, assertTenantAccess } from "../_shared/crm-referral.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const { sb: usb, error } = await requireUser(req);
  if (error) return error;
  try {
    const { payout_id, payment_reference, notes } = await req.json();
    if (!payout_id) return json({ error: "payout_id required" }, 400);
    const sb = svcClient();
    const { data: p, error: e1 } = await sb.from("crm_referral_payouts").select("*").eq("id", payout_id).single();
    if (e1) throw e1;
    if (!(await assertTenantAccess(usb!, p.tenant_id))) return json({ error: "Forbidden" }, 403);

    const { data, error: e2 } = await sb.from("crm_referral_payouts").update({
      payout_status: "paid", paid_at: new Date().toISOString(),
      payment_reference: payment_reference || null, notes: notes ?? p.notes,
    }).eq("id", payout_id).select().single();
    if (e2) throw e2;

    // Update partner totals + credit ledger if stored credit
    const partner = (await sb.from("crm_referral_partners").select("total_paid_out, total_earned").eq("id", p.partner_id).single()).data;
    await sb.from("crm_referral_partners").update({
      total_paid_out: Number(partner?.total_paid_out || 0) + Number(p.payout_amount),
      total_earned: Number(partner?.total_earned || 0) + Number(p.payout_amount),
    }).eq("id", p.partner_id);

    if (p.payout_type === "stored_credit" || p.payout_type === "account_credit") {
      const lastLedger = (await sb.from("crm_referral_account_credit_ledger")
        .select("balance_after").eq("partner_id", p.partner_id).order("created_at", { ascending: false }).limit(1).maybeSingle()).data;
      const prevBal = Number(lastLedger?.balance_after || 0);
      await sb.from("crm_referral_account_credit_ledger").insert({
        tenant_id: p.tenant_id, partner_id: p.partner_id, signup_id: p.signup_id,
        transaction_type: "credit_earned", amount: p.payout_amount,
        balance_after: prevBal + Number(p.payout_amount),
        description: `Payout #${p.id.slice(0, 8)}`,
      });
    }
    return json({ success: true, payout: data });
  } catch (e) {
    console.error(e); return json({ error: (e as Error).message }, 500);
  }
});
