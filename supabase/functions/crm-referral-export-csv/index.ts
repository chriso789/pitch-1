// Authenticated: exports B2B referral data as CSV. Admin only for payouts/credits.
import { corsHeaders, requireUser, svcClient, assertTenantAccess, toCsv } from "../_shared/crm-referral.ts";

const COLS: Record<string, string[]> = {
  partners: ["id","partner_code","partner_name","partner_email","partner_phone","company_name","status","tier","payout_type","payout_value","total_clicks","total_signups","total_paid_out","total_earned","created_at"],
  links: ["id","partner_id","link_code","utm_source","utm_medium","utm_campaign","is_active","click_count","signup_count","created_at"],
  signups: ["id","partner_id","company_name","company_email","company_phone","signup_status","subscription_plan","first_invoice_amount","first_year_value","paid_at","payout_eligible","payout_eligible_at","fraud_flag","created_at"],
  payouts: ["id","partner_id","signup_id","payout_amount","payout_status","payout_type","calculation_basis","approved_at","paid_at","payment_reference","payment_method","created_at"],
  credits: ["id","partner_id","signup_id","transaction_type","amount","balance_after","description","created_at"],
  flags: ["id","partner_id","signup_id","flag_reason","severity","status","resolved_at","created_at"],
};
const ADMIN_ONLY = new Set(["payouts","credits"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const { userId, sb: usb, error } = await requireUser(req);
  if (error) return error;
  try {
    const { tenant_id, dataset, date_from, date_to } = await req.json();
    if (!tenant_id || !dataset || !COLS[dataset]) {
      return new Response(JSON.stringify({ error: "tenant_id, dataset required" }), { status: 400, headers: corsHeaders });
    }
    if (!(await assertTenantAccess(usb!, tenant_id))) {
      return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: corsHeaders });
    }
    if (ADMIN_ONLY.has(dataset)) {
      const { data: isAdmin } = await usb!.rpc("has_high_level_role", { _user_id: userId });
      if (!isAdmin) return new Response(JSON.stringify({ error: "Admin required" }), { status: 403, headers: corsHeaders });
    }

    const table = ({
      partners: "crm_referral_partners",
      links: "crm_referral_links",
      signups: "crm_referral_company_signups",
      payouts: "crm_referral_payouts",
      credits: "crm_referral_account_credit_ledger",
      flags: "crm_referral_flags",
    } as const)[dataset as keyof typeof COLS];

    const sb = svcClient();
    let q = sb.from(table).select("*").eq("tenant_id", tenant_id).order("created_at", { ascending: false }).limit(10000);
    if (date_from) q = q.gte("created_at", date_from);
    if (date_to) q = q.lte("created_at", date_to);
    const { data, error: e } = await q;
    if (e) throw e;

    const csv = toCsv(data || [], COLS[dataset]);
    return new Response(csv, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="crm-referrals-${dataset}-${Date.now()}.csv"`,
      },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: corsHeaders });
  }
});
