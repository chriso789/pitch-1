// Spec-named API surface for the Company CRM Signup Referral System.
// Wraps the underlying spec-named edge functions (newly created) and the
// existing crm-referral-* functions to give the UI one consistent module.
import { supabase } from "@/integrations/supabase/client";

async function invoke<T = any>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) throw error;
  return data as T;
}

// ---- public + admin spec functions ----
export const createCrmReferralPartner = (payload: {
  referring_company_id: string;
  referring_user_id?: string;
  partner_contact_id?: string;
  partner_name: string;
  partner_email?: string;
  partner_phone?: string;
  partner_type?: string;
  campaign_name?: string;
}) => invoke<{ success: boolean; partner_id: string; partner_code: string; signup_referral_url: string }>(
  "create-crm-referral-partner", payload,
);

export const getPublicCrmReferralPage = (partner_code: string) =>
  invoke<{ success: boolean; partner_code: string; referring_partner_name: string | null;
    public_headline: string; public_subheadline: string; signup_enabled: boolean; terms_summary: string | null;
  }>("get-public-crm-referral-page", { partner_code });

export const trackCrmReferralEvent = (payload: Record<string, unknown>) =>
  invoke<{ success: boolean; event_id?: string }>("track-crm-referral-event", payload);

export const submitCrmReferralCompanySignup = (payload: Record<string, unknown>) =>
  invoke<{ success: boolean; signup_id: string; status: string }>(
    "submit-crm-referral-company-signup", payload,
  );

export const attachCrmReferralToNewCompany = (payload: {
  partner_code?: string; visitor_id?: string; session_id?: string;
  referred_company_id: string; owner_user_id?: string; owner_email?: string;
  subscription_id?: string; payment_customer_id?: string; selected_plan?: string;
}) => invoke<{ success: boolean; attributed: boolean; signup_id?: string; reason?: string }>(
  "attach-crm-referral-to-new-company", payload,
);

export const syncCrmReferralSubscriptionStatus = (payload: {
  referred_company_id?: string; subscription_id?: string; payment_customer_id?: string;
  status: string; paid_amount?: number; event_at?: string;
}) => invoke<{ success: boolean; status: string }>(
  "sync-crm-referral-subscription-status", payload,
);

export const approveCrmReferralPayout = (payload: {
  referral_company_signup_id: string; payout_method?: string; payout_amount?: number; notes?: string;
}) => invoke<{ success: boolean; payout: any }>("approve-crm-referral-payout", payload);

export const markCrmReferralPayoutPaid = (payload: {
  crm_referral_payout_id: string; payment_reference?: string; notes?: string;
}) => invoke<{ success: boolean; payout: any }>("mark-crm-referral-payout-paid", payload);

// ---- direct DB reads for settings UI ----
export async function getCompanyReferralSettings(tenantId: string) {
  const { data, error } = await supabase
    .from("crm_referral_program_settings" as any)
    .select("*").eq("tenant_id", tenantId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function saveCompanyReferralSettings(tenantId: string, patch: Record<string, unknown>) {
  const { data, error } = await supabase
    .from("crm_referral_program_settings" as any)
    .upsert({ tenant_id: tenantId, ...patch, updated_at: new Date().toISOString() }, { onConflict: "tenant_id" })
    .select().single();
  if (error) throw error;
  return data;
}

export async function getCompanyReferralPartners(tenantId: string) {
  const { data, error } = await supabase
    .from("crm_referral_partners" as any)
    .select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getCompanyReferralSignups(tenantId: string) {
  const { data, error } = await supabase
    .from("crm_referral_company_signups" as any)
    .select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getCompanyReferralPayouts(tenantId: string) {
  const { data, error } = await supabase
    .from("crm_referral_payouts" as any)
    .select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getCompanyReferralCredits(tenantId: string) {
  const { data, error } = await supabase
    .from("crm_referral_account_credit_ledger" as any)
    .select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getCompanyReferralFlags(tenantId: string) {
  const { data, error } = await supabase
    .from("crm_referral_flags" as any)
    .select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getCompanyReferralAnalytics(tenantId: string) {
  const [partners, signups, payouts] = await Promise.all([
    getCompanyReferralPartners(tenantId),
    getCompanyReferralSignups(tenantId),
    getCompanyReferralPayouts(tenantId),
  ]);
  return {
    partner_count: partners.length,
    signup_count: signups.length,
    active_paid_count: signups.filter((s: any) => s.signup_status === "active_paid").length,
    pending_payouts_total: payouts
      .filter((p: any) => p.payout_status === "pending" || p.payout_status === "approved")
      .reduce((a: number, p: any) => a + Number(p.payout_amount || 0), 0),
    paid_payouts_total: payouts
      .filter((p: any) => p.payout_status === "paid")
      .reduce((a: number, p: any) => a + Number(p.payout_amount || 0), 0),
  };
}
