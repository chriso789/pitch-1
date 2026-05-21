import { supabase } from "@/integrations/supabase/client";

async function invoke<T = any>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) throw error;
  return data as T;
}

export type CrmReferralDataset = "partners" | "links" | "signups" | "payouts" | "credits" | "flags";

export const trackCrmReferralClick = (payload: {
  partner_code: string;
  event_type?: "click" | "view";
  visitor_id?: string;
  session_id?: string;
  referrer_url?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
}) => invoke<{ success: boolean; partner_display_name: string }>("crm-referral-track-click", payload);

export const registerCrmReferralSignup = (payload: {
  partner_code: string;
  company_name: string;
  company_email: string;
  company_phone?: string;
  company_id?: string;
  admin_user_id?: string;
  subscription_plan?: string;
  metadata?: Record<string, unknown>;
}) => invoke<{ success: boolean; signup_id: string }>("crm-referral-register-signup", payload);

export const createCrmReferralLink = (p: {
  tenant_id: string; partner_id: string; utm_source?: string; utm_medium?: string;
  utm_campaign?: string; landing_page?: string;
}) => invoke<{ success: boolean; link: any; signup_url: string }>("crm-referral-create-link", p);

export const evaluateCrmReferralPayout = (signup_id: string) =>
  invoke<{ eligible: boolean; reason?: string; payout?: any; amount?: number }>("crm-referral-evaluate-payout", { signup_id });

export const approveCrmReferralPayout = (payout_id: string, notes?: string) =>
  invoke<{ success: boolean; payout: any }>("crm-referral-approve-payout", { payout_id, notes });

export const markCrmReferralPayoutPaid = (payout_id: string, payment_reference?: string, notes?: string) =>
  invoke<{ success: boolean; payout: any }>("crm-referral-mark-paid", { payout_id, payment_reference, notes });

export const resolveCrmReferralFlag = (flag_id: string, resolution_notes?: string) =>
  invoke<{ success: boolean }>("crm-referral-resolve-flag", { flag_id, resolution_notes });

export async function getPublicCrmReferralLink(code: string) {
  const { data, error } = await supabase.rpc("get_public_crm_referral_link", { _code: code });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

export async function exportCrmReferralCsv(p: {
  tenant_id: string; dataset: CrmReferralDataset; date_from?: string; date_to?: string;
}) {
  const { data: { session } } = await supabase.auth.getSession();
  const url = `${(supabase as any).functionsUrl || ""}/crm-referral-export-csv`;
  const res = await fetch(
    `https://alxelfrbjzkmtnsulcei.supabase.co/functions/v1/crm-referral-export-csv`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session?.access_token || ""}`,
      },
      body: JSON.stringify(p),
    },
  );
  if (!res.ok) throw new Error(`Export failed: ${res.status}`);
  const blob = await res.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `crm-referrals-${p.dataset}-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
