import { supabase } from "@/integrations/supabase/client";

export interface InsertReferralStatusHistoryPayload {
  tenant_id: string;
  referral_submission_id: string;
  old_status: string | null;
  new_status: string;
  reason?: string | null;
  changed_by?: string | null;
}

export async function insertReferralStatusHistory(payload: InsertReferralStatusHistoryPayload) {
  const { error } = await supabase.from("referral_status_history").insert({
    tenant_id: payload.tenant_id,
    referral_submission_id: payload.referral_submission_id,
    old_status: payload.old_status,
    new_status: payload.new_status,
    reason: payload.reason ?? null,
    changed_by: payload.changed_by ?? null,
  });
  if (error) throw error;
}

export async function getReferralStatusTimeline(referralSubmissionId: string) {
  const { data, error } = await supabase
    .from("referral_status_history")
    .select("*")
    .eq("referral_submission_id", referralSubmissionId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}
