import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { jsonResponse, referralCors } from "../_shared/referralSecurity.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: referralCors });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return jsonResponse({ error: "unauthorized" }, 401);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: uErr } = await userClient.auth.getUser();
    if (uErr || !userData?.user) return jsonResponse({ error: "unauthorized" }, 401);
    const userId = userData.user.id;

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const body = await req.json();
    const { referral_payout_id, payment_reference, notes } = body;
    if (!referral_payout_id) return jsonResponse({ error: "referral_payout_id required" }, 400);

    const { data: payout } = await supabase
      .from("referral_payouts")
      .select("*")
      .eq("id", referral_payout_id)
      .maybeSingle();
    if (!payout) return jsonResponse({ error: "not_found" }, 404);

    const { data: profile } = await supabase
      .from("profiles")
      .select("tenant_id, active_tenant_id")
      .eq("id", userId)
      .maybeSingle();
    const allowed = profile?.tenant_id === payout.tenant_id || profile?.active_tenant_id === payout.tenant_id;
    if (!allowed) return jsonResponse({ error: "forbidden" }, 403);

    const { data: updated, error } = await supabase
      .from("referral_payouts")
      .update({
        payout_status: "paid",
        paid_at: new Date().toISOString(),
        payment_reference: payment_reference ?? payout.payment_reference,
        notes: notes ?? payout.notes,
      })
      .eq("id", referral_payout_id)
      .select("*")
      .single();
    if (error) throw error;

    return jsonResponse({ success: true, payout: updated });
  } catch (e) {
    console.error("[mark-referral-payout-paid]", e);
    return jsonResponse({ error: "internal_error", message: (e as Error).message }, 500);
  }
});
