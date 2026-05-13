import { useState } from "react";
import { submitReferralLead } from "@/lib/referrals/api";
import { useReferralTracking } from "./useReferralTracking";

export function useSubmitReferralLead(referralCode: string | null | undefined) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ id: string; status: string; message: string } | null>(null);
  const { track, visitorId, sessionId } = useReferralTracking(referralCode);

  async function submit(payload: Record<string, unknown>) {
    if (!referralCode) return;
    setLoading(true);
    setError(null);
    try {
      const res = await submitReferralLead({
        ...payload,
        referral_code: referralCode,
        visitor_id: visitorId,
        session_id: sessionId,
      });
      setSuccess({ id: res.referral_submission_id, status: res.status, message: res.message });
      track("form_submit", { submission_id: res.referral_submission_id, status: res.status });
      return res;
    } catch (e: any) {
      setError(e?.message ?? "Submission failed");
      throw e;
    } finally {
      setLoading(false);
    }
  }

  return { submit, loading, error, success };
}
