import {
  getSupabaseAdminClient,
  jsonResponse,
  referralCors,
  resolveReferralLinkByCode,
} from "../_shared/referralSecurity.ts";
import { validatePayoutPreferencePayload } from "../_shared/referralValidation.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: referralCors });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  try {
    const body = await req.json();
    const { referral_code } = body;
    if (!referral_code) return jsonResponse({ error: "referral_code required" }, 400);

    const supabase = getSupabaseAdminClient();
    const link = await resolveReferralLinkByCode(supabase, referral_code);
    if (!link || !link.customer_id) return jsonResponse({ error: "invalid_code" }, 404);

    const { data: settings } = await supabase
      .from("referral_program_settings")
      .select("*")
      .eq("tenant_id", link.tenant_id)
      .maybeSingle();

    const v = validatePayoutPreferencePayload(body, settings);
    if (!v.ok) return jsonResponse({ error: v.error }, 400);

    const upsert = {
      tenant_id: link.tenant_id,
      referrer_contact_id: link.customer_id,
      preferred_payout_method: body.preferred_payout_method,
      venmo_handle: body.venmo_handle ?? null,
      zelle_email: body.zelle_email ?? null,
      zelle_phone: body.zelle_phone ?? null,
      gift_card_email: body.gift_card_email ?? null,
      stored_balance_enabled: body.stored_balance_enabled ?? (body.preferred_payout_method === "stored_balance"),
      tax_acknowledgment: body.tax_acknowledgment === true,
      payout_terms_accepted: body.payout_terms_accepted === true,
    };

    const { error } = await supabase
      .from("referrer_payout_profiles")
      .upsert(upsert, { onConflict: "tenant_id,referrer_contact_id" });
    if (error) throw error;

    await supabase.from("referral_events").insert({
      tenant_id: link.tenant_id,
      referral_link_id: link.id,
      referrer_contact_id: link.customer_id,
      event_type: "payout_choice_saved",
      metadata: { method: body.preferred_payout_method },
    });

    return jsonResponse({ success: true, message: "Your referral reward preference has been saved." });
  } catch (e) {
    console.error("[save-referral-payout-preference]", e);
    return jsonResponse({ error: "internal_error", message: (e as Error).message }, 500);
  }
});
