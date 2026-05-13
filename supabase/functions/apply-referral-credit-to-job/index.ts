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
    const { referrer_contact_id, job_id, amount, notes } = body;
    if (!referrer_contact_id || !job_id || !amount || amount <= 0) {
      return jsonResponse({ error: "invalid_payload" }, 400);
    }

    const { data: contact } = await supabase
      .from("contacts")
      .select("id, tenant_id")
      .eq("id", referrer_contact_id)
      .maybeSingle();
    if (!contact) return jsonResponse({ error: "contact_not_found" }, 404);

    const { data: profile } = await supabase
      .from("profiles")
      .select("tenant_id, active_tenant_id")
      .eq("id", userId)
      .maybeSingle();
    const allowed = profile?.tenant_id === contact.tenant_id || profile?.active_tenant_id === contact.tenant_id;
    if (!allowed) return jsonResponse({ error: "forbidden" }, 403);

    const { data: balData } = await supabase.rpc("get_referrer_credit_balance", {
      _tenant_id: contact.tenant_id,
      _contact_id: referrer_contact_id,
    });
    const currentBalance = Number(balData ?? 0);
    if (amount > currentBalance) {
      return jsonResponse({ error: "insufficient_balance", balance: currentBalance }, 400);
    }

    const { data: ledger, error } = await supabase
      .from("referral_credit_ledger")
      .insert({
        tenant_id: contact.tenant_id,
        referrer_contact_id,
        transaction_type: "credit_used",
        amount: -Math.abs(amount),
        balance_after: 0, // trigger fills it
        related_job_id: job_id,
        notes: notes ?? `Applied to job ${job_id}`,
        created_by: userId,
      })
      .select("balance_after")
      .single();
    if (error) throw error;

    return jsonResponse({ success: true, balance_after: ledger.balance_after });
  } catch (e) {
    console.error("[apply-referral-credit-to-job]", e);
    return jsonResponse({ error: "internal_error", message: (e as Error).message }, 500);
  }
});
