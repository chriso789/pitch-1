import { supabase } from "@/integrations/supabase/client";

async function invoke<T = any>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) throw error;
  return data as T;
}

export const trackReferralEvent = (payload: {
  referral_code: string;
  event_type: string;
  visitor_id?: string;
  session_id?: string;
  landing_url?: string;
  referrer_url?: string;
  user_agent?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  fbclid?: string;
  gclid?: string;
  msclkid?: string;
  ttclid?: string;
  metadata?: Record<string, unknown>;
}) => invoke<{ success: boolean; event_id: string }>("referral-track-event", payload);

export const submitReferralLead = (payload: Record<string, unknown>) =>
  invoke<{ success: boolean; referral_submission_id: string; status: string; message: string }>(
    "submit-referral-lead",
    payload,
  );

export const saveReferralPayoutPreference = (payload: Record<string, unknown>) =>
  invoke<{ success: boolean; message: string }>("save-referral-payout-preference", payload);

export const createReferralLink = (payload: {
  tenant_id: string;
  referrer_contact_id: string;
  source_job_id?: string;
  campaign_id?: string;
  custom_note?: string;
}) =>
  invoke<{
    success: boolean;
    referral_link_id: string;
    referral_code: string;
    referral_url: string;
    reward_url: string;
    share_message_sms: string;
    share_message_email_subject: string;
    share_message_email_body: string;
  }>("create-referral-link", payload);

export const approveReferralPayout = (payload: {
  referral_submission_id: string;
  payout_method?: string;
  payout_amount?: number;
  notes?: string;
}) => invoke<{ success: boolean; payout: any }>("approve-referral-payout", payload);

export const markReferralPayoutPaid = (payload: {
  referral_payout_id: string;
  payment_reference?: string;
  notes?: string;
}) => invoke<{ success: boolean; payout: any }>("mark-referral-payout-paid", payload);

export const applyReferralCreditToJob = (payload: {
  referrer_contact_id: string;
  job_id: string;
  amount: number;
  notes?: string;
}) => invoke<{ success: boolean; balance_after: number }>("apply-referral-credit-to-job", payload);

export async function getPublicReferralPage(referralCode: string) {
  const { data, error } = await supabase.rpc("get_public_referral_link", { _code: referralCode });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

export async function getPublicReferralRewardProfile(referralCode: string) {
  const { data, error } = await supabase.rpc("get_public_referral_reward_profile", { _code: referralCode });
  if (error) throw error;
  return data as any;
}
