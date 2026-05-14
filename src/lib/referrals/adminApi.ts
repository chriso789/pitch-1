import { supabase } from "@/integrations/supabase/client";
import {
  createReferralLink as createReferralLinkFn,
  approveReferralPayout as approvePayoutFn,
  markReferralPayoutPaid as markPaidFn,
  applyReferralCreditToJob as applyCreditFn,
} from "./api";

// ============ Reads ============

export async function getReferralOverview(tenantId: string) {
  const [linksRes, eventsRes, submissionsRes, payoutsRes, creditsRes] = await Promise.all([
    supabase.from("referral_codes").select("id,is_active,current_uses").eq("tenant_id", tenantId),
    supabase
      .from("referral_events")
      .select("id,event_type,visitor_id,created_at,utm_source,utm_campaign")
      .eq("tenant_id", tenantId),
    supabase
      .from("referral_submissions")
      .select("id,status,sold_value,estimated_value,service_needed,created_at,referrer_contact_id,payout_eligible")
      .eq("tenant_id", tenantId),
    supabase
      .from("referral_payouts")
      .select("id,payout_status,payout_amount,referrer_contact_id,created_at")
      .eq("tenant_id", tenantId),
    supabase
      .from("referral_credit_ledger")
      .select("referrer_contact_id,amount,balance_after,transaction_type,created_at")
      .eq("tenant_id", tenantId),
  ]);

  return {
    links: linksRes.data ?? [],
    events: eventsRes.data ?? [],
    submissions: submissionsRes.data ?? [],
    payouts: payoutsRes.data ?? [],
    credits: creditsRes.data ?? [],
  };
}

export async function getReferralLinks(tenantId: string) {
  const { data, error } = await supabase
    .from("referral_codes")
    .select(
      "id,code,reward_type,reward_value,is_active,status,current_uses,created_at,source_job_id,customer_id,contacts:customer_id(first_name,last_name,phone,email)",
    )
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getReferralSubmissions(tenantId: string) {
  const { data, error } = await supabase
    .from("referral_submissions")
    .select(
      "*, referrer:referrer_contact_id(first_name,last_name,phone,email), referral_codes:referral_link_id(code)",
    )
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getReferralPayouts(tenantId: string) {
  const { data, error } = await supabase
    .from("referral_payouts")
    .select(
      "*, referrer:referrer_contact_id(first_name,last_name), submission:referral_submission_id(referred_first_name,referred_last_name)",
    )
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getReferralCreditBalances(tenantId: string) {
  const { data, error } = await supabase
    .from("referral_credit_ledger")
    .select(
      "referrer_contact_id,amount,balance_after,transaction_type,created_at,contacts:referrer_contact_id(first_name,last_name)",
    )
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  // Aggregate balances per referrer
  const byContact = new Map<string, any>();
  for (const row of data ?? []) {
    const id = row.referrer_contact_id as string;
    const existing = byContact.get(id);
    if (!existing) {
      byContact.set(id, {
        referrer_contact_id: id,
        contact: row.contacts,
        current_balance: row.balance_after ?? 0,
        total_earned: 0,
        total_used: 0,
        last_activity: row.created_at,
      });
    }
    const agg = byContact.get(id);
    if (row.transaction_type === "credit_earned") agg.total_earned += Number(row.amount || 0);
    if (row.transaction_type === "credit_used") agg.total_used += Math.abs(Number(row.amount || 0));
  }
  return Array.from(byContact.values());
}

export async function getReferralCreditLedger(tenantId: string, referrerContactId: string) {
  const { data, error } = await supabase
    .from("referral_credit_ledger")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("referrer_contact_id", referrerContactId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getReferralFlags(tenantId: string) {
  const { data, error } = await supabase
    .from("referral_flags")
    .select(
      "*, submission:referral_submission_id(referred_first_name,referred_last_name,referrer_contact_id)",
    )
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getReferralSettings(tenantId: string) {
  const { data, error } = await supabase
    .from("referral_program_settings")
    .select("*")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function saveReferralSettings(tenantId: string, payload: Record<string, any>) {
  const { data: existing } = await supabase
    .from("referral_program_settings")
    .select("id")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (existing?.id) {
    const { error } = await supabase
      .from("referral_program_settings")
      .update(payload)
      .eq("id", existing.id);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from("referral_program_settings")
      .insert({ tenant_id: tenantId, ...payload });
    if (error) throw error;
  }
}

export async function searchContacts(tenantId: string, query: string) {
  if (!query || query.length < 2) return [];
  const { data, error } = await supabase
    .from("contacts")
    .select("id,first_name,last_name,phone,email")
    .eq("tenant_id", tenantId)
    .or(`first_name.ilike.%${query}%,last_name.ilike.%${query}%,email.ilike.%${query}%,phone.ilike.%${query}%`)
    .limit(15);
  if (error) throw error;
  return data ?? [];
}

// ============ Mutations ============

export async function deactivateReferralLink(id: string) {
  const { error } = await supabase.from("referral_codes").update({ is_active: false }).eq("id", id);
  if (error) throw error;
}

export async function reactivateReferralLink(id: string) {
  const { error } = await supabase.from("referral_codes").update({ is_active: true }).eq("id", id);
  if (error) throw error;
}

export async function updateReferralSubmissionStatus(
  tenantId: string,
  submissionId: string,
  newStatus: string,
  reason?: string,
) {
  const { data: current } = await supabase
    .from("referral_submissions")
    .select("status")
    .eq("id", submissionId)
    .maybeSingle();
  const oldStatus = current?.status ?? null;
  const { error } = await supabase
    .from("referral_submissions")
    .update({ status: newStatus })
    .eq("id", submissionId);
  if (error) throw error;
  await supabase.from("referral_status_history").insert({
    tenant_id: tenantId,
    referral_submission_id: submissionId,
    old_status: oldStatus,
    new_status: newStatus,
    reason: reason ?? null,
  });
}

export async function rejectReferralSubmission(tenantId: string, submissionId: string, reason: string) {
  return updateReferralSubmissionStatus(tenantId, submissionId, "rejected", reason);
}

export async function markReferralValid(tenantId: string, submissionId: string, reason?: string) {
  await supabase
    .from("referral_submissions")
    .update({ payout_eligible: true, payout_eligibility_reason: reason ?? "manual_admin_override" })
    .eq("id", submissionId);
  await supabase.from("referral_status_history").insert({
    tenant_id: tenantId,
    referral_submission_id: submissionId,
    old_status: null,
    new_status: "marked_valid",
    reason: reason ?? null,
  });
}

export async function resolveReferralFlag(flagId: string, userId: string) {
  const { error } = await supabase
    .from("referral_flags")
    .update({ resolved: true, resolved_at: new Date().toISOString(), resolved_by: userId })
    .eq("id", flagId);
  if (error) throw error;
}

export async function logReferralSend(payload: {
  tenant_id: string;
  referral_link_id: string;
  referrer_contact_id: string | null;
  channel: string;
  recipient: string;
  sent_by: string;
  message_subject?: string;
  message_body?: string;
  status?: string;
  provider_message_id?: string;
  error_message?: string;
}) {
  const { tenant_id, referral_link_id, referrer_contact_id, channel, recipient, sent_by, ...rest } = payload;
  const { error } = await supabase.from("referral_send_logs").insert({
    tenant_id,
    referral_link_id,
    referrer_contact_id,
    channel,
    recipient,
    sent_by,
    metadata: rest,
  });
  if (error) throw error;
}

export const createReferralLink = createReferralLinkFn;
export const approveReferralPayout = approvePayoutFn;
export const markReferralPayoutPaid = markPaidFn;
export const applyReferralCreditToJob = applyCreditFn;
